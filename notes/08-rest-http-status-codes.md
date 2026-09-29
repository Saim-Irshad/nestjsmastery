# 08 — REST & HTTP: status codes, methods, idempotency

> 📍 **Where on the Big Map:** the outermost inch of every request, on both ends. Before Nest picks a controller it has already read the **method** (`GET`, `POST`, `PATCH`) and the **path**; after your handler returns, the very last thing Nest does is write a **status line**. Everything in notes 05, 06, 07 and 16 happens between those two moments.
> 📘 **Course:** videos 10 (Response Status Codes) · 11 (Handling Update and Delete Requests — this one has no audio track and no subtitle file on the drive, so that section is written from the code in this repo instead) · 12 (Implement Pagination with Query Parameters)
> 🌿 **Branch:** `config`
> 📚 **Docs:** [Nest — status codes](https://docs.nestjs.com/controllers#status-code) · [MDN — HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status) · [MDN — HTTP request methods](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods)

---

**Read this part first, because it is the reason the note exists.**

Almost everything in these notes is about NestJS, and NestJS is a thing you could stop using next year. This note is not. Status codes, methods and idempotency are HTTP, and HTTP is what your React app, your mobile client, every CDN, every load balancer, every proxy and every backend you will ever write are all already speaking. The Nest part of this note is about fifteen lines long. The rest transfers to Express, Go, Rails, or whatever you are writing in 2031.

And it lands directly in the thing you are about to build. A football / esports tournament API has a referee on a phone, on stadium wifi, pressing **"goal scored"**. The request goes out, the network stalls, the phone gives up and sends it again. If your API is built the way the coffee API is built today, that match now has **two goals**, and nobody can tell from the database which one was real. Section 3 step 5 is about exactly that, and it is the part of this note worth re-reading.

---

## 1. The problem

Start from the end you already know: the client.

You have written this loop a hundred times without thinking about who, on the other side, decided what `res.ok` would be:

```js
const res = await fetch('/api/coffee/999');

if (!res.ok) {                       // ← a decision made by the server, one line of it
  if (res.status === 401) return redirectToLogin();
  if (res.status === 403) return showMessage("You don't have permission");
  if (res.status === 404) return showNotFound();
  if (res.status >= 500) return retryWithBackoff();   // ← and this one is the dangerous one
  return showError(await res.json());
}

const coffee = await res.json();
```

Look at what that code is doing. It never reads the body to find out whether something went wrong. It reads **one number**, and from that number it decides whether to render, to log the user out, to show a red box, or to **send the same request again**. Your axios interceptor that refreshes a token does the same thing. React Query's `retry` does the same thing. The browser's HTTP cache does the same thing — a 200 may be stored and replayed, a 404 usually is not, a 500 never is. The CDN in front of your API does the same thing. Your monitoring dashboard's "error rate" graph is literally a count of responses whose first digit was 5.

So the number in the status line is not decoration on top of the real answer. For most of the software that talks to your API, **it is the answer**, and the JSON body is a detail that only a human ever reads.

That means the server owes the client three things, and only the first one is obvious:

1. **Say what happened** — did it work, did the caller get it wrong, did we break.
2. **Say who should fix it** — because that decides whether retrying is sane. A 4xx means retrying the identical request is pointless forever. A 5xx means retrying might work in two seconds.
3. **Say whether doing this twice is safe** — which is not in the status code at all. It's in the *method*, and it is the part nobody teaches, and it is the part that silently corrupts data.

Here is the naive version, which you have already written once in this repo, in `src/user/user.service.ts` (note 05 §1):

```ts
getUserById(id: string) {
  const user = this.users.find(...);
  if (user) return user;
  return { message: 'User not found' };   // ❌ goes out as 200 OK
}
```

`if (!res.ok)` never fires, the UI renders `undefined`, the error-rate graph stays flat, and a proxy is within its rights to cache "not found" as a success. Note 05 fixed that with `throw new NotFoundException(...)`. This note is about the rest of the surface: which number for which situation, which method for which operation, and the one property of methods — safe to repeat, or not — that decides whether a flaky network costs you a duplicate row.

## 2. Mental model

A parcel with a **stamped label on the outside** and a **letter inside**.

```
          ┌─────────────────────────────────────────────┐
          │  HTTP/1.1 404 Not Found         ← the stamp │   read by: fetch, axios, the browser
          │  Content-Type: application/json             │   cache, the CDN, the load balancer,
          │                                             │   your retry logic, your dashboards
          │  ┌───────────────────────────────────────┐  │
          │  │ {"message":"Coffee #999 not found"}   │  │   read by: a human, eventually,
          │  │                    ← the letter       │  │   in a console or a red toast
          │  └───────────────────────────────────────┘  │
          └─────────────────────────────────────────────┘
```

Every automated thing reads the stamp. Only people read the letter. Putting "it failed" in the letter and "everything is fine" on the stamp is the 200-with-an-error-body bug, and it is a lie told to every piece of machinery in the chain at once.

And the frontend comparison for the methods half of this note is one you already use daily:

```js
setCount(count + 1);     // "add one to whatever it is"   → run it twice, you get +2   ← POST-shaped
setCount(5);             // "make it 5"                    → run it twice, still 5     ← PUT-shaped
```

React's `setState` with a value is *replace*, and replacing is repeatable. `count + 1` is *append*, and appending is not. HTTP methods carry the same distinction, and the whole of section 3 step 5 is about the fact that the network will run your call twice whether you planned for it or not.

## 3. Baby steps

### Step 1 — What Nest already does, before you ask it anything

You have not written a single line about status codes in this repo, and yet the responses have been correct so far. Measured against the real app on 2026-09-29 (`docker compose up -d`, `pnpm build`, `PORT=3990 node dist/main.js`):

```
$ curl -i -X POST localhost:3990/coffee -H 'Content-Type: application/json' \
       -d '{"name":"Idempotency Latte","brand":"Nest","flavor":["vanilla"]}'

HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
{"statusCode":201,"data":{"id":7,"name":"Idempotency Latte","brand":"Nest","flavor":[{"id":1,"name":"vanilla"}]},"success":true}
```

```
$ curl -i "localhost:3990/coffee?limit=2&offset=2"

HTTP/1.1 200 OK
{"statusCode":200,"data":[{"id":4,"name":"vanilla2",...},{"id":5,"name":"latte",...}],"success":true}
```

The whole rule is two words long: **POST gets 201, everything else gets 200.** That is it. Not "Nest looks at what you returned", not "Nest checks whether a row was created" — it looks at the HTTP method and nothing else. Section 4 has the eight lines of Nest source that do it.

(The `{statusCode, data, success}` wrapper around the bodies is not HTTP, it is your own `TransformInterceptor` from note 06, bound at `src/main.ts:69`. Note that the `statusCode` inside the body is a **copy** the interceptor put there. The one that matters is on the status line.)

### Step 2 — Override it: `@HttpCode`

When the default is wrong, one decorator fixes it. The course's example is deprecating a route:

```ts
import { HttpCode, HttpStatus } from '@nestjs/common';

@Post('deprecated')
@HttpCode(HttpStatus.GONE)              // HttpStatus.GONE is 410; the enum saves you memorising numbers
deprecated() { return { message: 'use POST /coffee' }; }
```

Measured in a scratch Nest app on port 3991 (2026-09-29 — the repo's own `src/` is untouched by this note):

```
$ curl -i -X POST localhost:3991/coffee/deprecated
HTTP/1.1 410 Gone
Content-Type: application/json; charset=utf-8
```

`@HttpCode` only works for a **static** code, one that is the same for every request to that route. When the code depends on what happened — 404 if the row is missing, 409 if the name is taken — you do not compute it here. You throw, and the exception carries its own code. That is note 05's whole subject and this note does not repeat it: **the table of `NotFoundException` / `ConflictException` / `ForbiddenException` and friends lives in [note 05 §3.5](05-exception-filters.md).** `@HttpCode` is for success codes. Exceptions are for failure codes.

### Step 3 — The one override worth knowing by heart: 204 on DELETE

Here is what `DELETE /coffee/8` returns today, measured against the real app:

```
$ curl -i -X DELETE localhost:3990/coffee/8

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 64

{"statusCode":200,"data":{"raw":[],"affected":1},"success":true}
```

`{"raw":[],"affected":1}` is not an API. It is TypeORM's `DeleteResult` leaking straight through `src/coffee/coffee.service.ts:136` and out onto the wire. Three separate things are wrong with it, and they get worse in that order:

1. **It means nothing to a client.** A frontend developer receiving `affected: 1` has to know that you use TypeORM, and that TypeORM calls it that, to understand it. `raw: []` means nothing to anyone.
2. **It is a promise you did not mean to make.** Anything you send becomes part of your contract. The day you swap TypeORM for Prisma, or wrap the delete in a transaction that returns something else, that field changes shape and somebody's code breaks — for no benefit, because nobody wanted it.
3. **It says 200 OK, which means "here is the thing you asked for".** There is no thing. The resource is gone. That is what **204 No Content** exists to say.

The fix is one decorator:

```ts
@Delete('/:id')
@HttpCode(HttpStatus.NO_CONTENT)       // 204
deleteById(@Param('id', ParseIntPipe) id: number) {
  return this.coffeeService.deleteById(id);
}
```

And here is the part that surprised me, measured in the scratch app where the handler **still returns `{ affected: 1 }`**:

```
$ curl -i -X DELETE localhost:3991/coffee/quiet/2

HTTP/1.1 204 No Content
X-Powered-By: Express
ETag: W/"e-nTK8mQrnW/iMZpuV8lVxOxjxy9Q"
Date: Tue, 29 Sep 2026 06:42:42 GMT

$ curl -s -o /dev/null -w 'status=%{http_code} size=%{size_download}\n' -X DELETE localhost:3991/coffee/quiet/2
status=204 size=0
```

**Zero bytes, no `Content-Type`, no `Content-Length`** — even though the handler returned an object. The body did not get dropped by Nest; it got dropped by Express, at `node_modules/.pnpm/express@5.2.1/.../lib/response.js:202`:

```js
if (204 === this.statusCode || 304 === this.statusCode) {
  this.removeHeader('Content-Type');
  this.removeHeader('Content-Length');
  this.removeHeader('Transfer-Encoding');
  chunk = '';
}
```

That is the HTTP spec being enforced two layers below you: a 204 response **must not** have a body, so the library throws yours away silently. Worth knowing, because the first time you see a 204 arrive empty in the browser's network tab while your handler clearly returned data, it looks like a bug in your code.

**So which does a DELETE return?** Both are defensible, and the choice is a contract decision, not a correctness one:

| Choice | When it's right |
|---|---|
| `204` with no body | The normal one. The client asked for it gone; it's gone; there is nothing to say. Your React code does `if (res.ok) removeFromList(id)` and never calls `res.json()`. |
| `200` with the deleted object | When the client needs the row back — an undo toast ("Deleted *Latte*. Undo?"), or an audit log that wants to record what was removed. `return coffee;` before the delete, not `DeleteResult`. |

What is not defensible is returning the ORM's internal bookkeeping. ⚠️ And if you pick 204, make sure the frontend never calls `res.json()` on it: parsing an empty body throws `SyntaxError: Unexpected end of JSON input`, which is a confusing way to find out your delete succeeded.

### Step 4 — The five families, in plain words

You only need a dozen of these. Here is each family as a sentence about **what the caller should do next**, which is the only thing a family really encodes.

**2xx — it worked.** The request was understood, accepted and carried out. Whatever is in the body is real data, and it's safe to render it, store it, and cache it if the headers allow.

**3xx — it's somewhere else.** The thing exists but not here; follow the `Location` header. You will meet these mostly through `fetch` handling them invisibly for you, and in OAuth flows. Not something you will emit by hand for a JSON API.

**4xx — the caller got it wrong, and sending the identical request again will never work.** Something about *this request* — its URL, its body, its headers, its credentials — is the problem. The client must change something before trying again. This is the line that matters for retry logic: an automatic retry of a 4xx is pure waste, forever.

**5xx — we got it wrong, and retrying might genuinely help.** The request was fine; the server failed to handle it. A dropped database connection, a bug, a dependency that timed out. The caller did nothing wrong and can reasonably wait and try again. This is also the family that pages on-call at 3am, which is exactly why putting a user's typo in this family is a small act of violence against whoever is carrying the phone.

**1xx — informational.** You will not emit one deliberately for years. Skip it.

The codes you will actually use:

| Code | Name | What it means here |
|---|---|---|
| **200** | OK | Here is what you asked for. GET, PATCH, PUT. |
| **201** | Created | Something new exists now. POST. Should carry a `Location` header pointing at it. |
| **204** | No Content | Done, and there is nothing to send back. DELETE. |
| **400** | Bad Request | The request is malformed or fails validation. Your `ValidationPipe` and `ParseIntPipe` throw this (note 07). |
| **401** | Unauthorized | "I don't know who you are." Missing, malformed or expired credentials. Badly named — it means *unauthenticated*. |
| **403** | Forbidden | "I know who you are, and you may not do this." Valid credentials, insufficient rights. |
| **404** | Not Found | No such route, or no such row. |
| **409** | Conflict | The request clashes with the current state: the email is taken, the booking is gone, you're editing a stale version. |
| **422** | Unprocessable Content | The syntax is fine and the fields are the right types, but the request makes no sense as a whole: an end date before the start date, a tournament match between a team and itself. |
| **429** | Too Many Requests | Rate limit. Send a `Retry-After` header with it, or clients will hammer you harder. |
| **500** | Internal Server Error | We broke. Never emit this on purpose for a user mistake. |
| **503** | Service Unavailable | We are alive but cannot serve right now — overloaded, or a dependency is down, or we're deploying. Explicitly retryable, and also takes `Retry-After`. |

**400 vs 422 is the one people argue about.** A useful split: 400 when the request is *shaped* wrong (not JSON, missing a required field, `limit=abc` where a number goes), 422 when every field is individually valid but the combination is impossible. In practice Nest's `ValidationPipe` throws 400 for both and most APIs live happily with that. Pick one rule and apply it everywhere; consistency is worth more here than being right.

**404 vs 403 is the one that has security consequences**, and it comes up the moment you have users. If Ali asks for Sana's private tournament, do you send 403 ("that exists, you can't see it") or 404 ("no such thing")? 403 is more honest and leaks the fact that the resource exists — which, for a URL like `/tournament/secret-signing-2027`, is the whole secret. 404 leaks nothing and confuses your own developers. The common rule: **404 for things the caller isn't allowed to know exist, 403 for things they know about but may not touch.**

Everything about *which exception class throws which of these* is in [note 05 §3.5](05-exception-filters.md), including what the bodies look like and why `exception.message` is not the message.

### Step 5 — Methods, and the reason methods actually matter

The course's video 11 on update and delete has no audio track and no subtitles on the drive, so this section is written from this repo's code and from responses measured against it.

The easy half first, because it's three sentences:

| Method | What it says |
|---|---|
| **POST** | "Make a new one." The client does not know the id; the server invents it and returns it. |
| **PUT** | "Here is the complete resource for this id. Store exactly this." Whatever you don't send is *gone*. |
| **PATCH** | "Here are the fields I want changed. Leave the rest alone." |

That is the part every tutorial covers, and on its own it sounds like etiquette. It is not etiquette. Here is why it matters.

#### The failure

Your referee taps "goal scored". The phone sends:

```
POST /match/77/goal    {"player": 9, "minute": 88}
```

The request reaches your server. Your server writes the row. The response starts coming back — and the stadium wifi drops. The phone never sees a reply. It has no way on earth to tell "my request never arrived" from "my request arrived and the answer got lost". So it does the sensible thing that every HTTP client library does by default, and sends it again.

I ran exactly this against the repo's real `POST /coffee`, twice, with a byte-identical body (2026-09-29):

```
$ curl -i -X POST localhost:3990/coffee -d '{"name":"Idempotency Latte","brand":"Nest","flavor":["vanilla"]}' ...
HTTP/1.1 201 Created
{"statusCode":201,"data":{"id":7,"name":"Idempotency Latte",...},"success":true}

$ # the exact same command again — this is the retry
HTTP/1.1 201 Created
{"statusCode":201,"data":{"id":8,"name":"Idempotency Latte",...},"success":true}
```

```
$ curl localhost:3990/coffee
{"statusCode":200,"data":[
  {"id":5,"name":"latte",...},
  {"id":7,"name":"Idempotency Latte",...},     ← the request
  {"id":8,"name":"Idempotency Latte",...},     ← the retry
  ...
],"success":true}
```

**Two rows.** Two coffees, or two goals, or two payments. The server did nothing wrong: it was asked twice to create something, and it created something twice. The bug is in the shape of the operation.

Now the same experiment with PUT, in the scratch app, three times with the same body:

```
$ for i in 1 2 3; do curl -X PUT localhost:3991/coffee/1 -d '{"name":"flat white"}'; done
status=200 status=200 status=200

$ curl localhost:3991/coffee
[... {"id":1,"name":"flat white"}]      ← one row, exactly as after the first call
```

Three identical calls, one result. And PATCH, twice, against the real app:

```
$ curl -i -X PATCH localhost:3990/coffee/7 -d '{"name":"Patched Latte"}'
HTTP/1.1 200 OK
{"statusCode":200,"data":{"id":7,"name":"Patched Latte","brand":"Nest"},"success":true}

$ # again
HTTP/1.1 200 OK
{"statusCode":200,"data":{"id":7,"name":"Patched Latte","brand":"Nest"},"success":true}
```

Byte-identical. Nothing extra happened.

#### The property, stated as a question

Forget dictionaries. The question is:

> **If the network drops and the client sends this exact request again, does doing it twice do damage?**

- `GET /coffee/1` — asks for a thing. Ask twice, you get told twice. No damage.
- `PUT /coffee/1 {"name":"flat white"}` — "make it this". Say it twice, it is still this. No damage.
- `DELETE /coffee/8` — "make it not exist". Say it twice, it still does not exist. No damage to the *data* (more on the status code below).
- `POST /coffee {...}` — "make a new one". Say it twice, **two things exist**. Damage.

The name for "doing it twice changes nothing beyond doing it once" is **idempotent**, and by the specification GET, PUT and DELETE are idempotent while POST and PATCH are not. GET additionally promises to change nothing at all, which is called **safe** — that is why a browser will happily re-issue a GET when you hit back, and will warn you before re-issuing a POST.

Two honest footnotes, because the spec's version is tidier than reality:

- **PATCH is not idempotent in general.** `{"name":"x"}` happens to be, because it's a replace of one field. `{"$inc": {"goals": 1}}` is not, and neither is anything that appends to a list. Whether your PATCH is safe to retry depends on what your PATCH does, which is why "PATCH is idempotent" is a claim about your code, not about HTTP.
- **DELETE is idempotent in effect but not in status.** Measured on the real app:

  ```
  $ curl -i -X DELETE localhost:3990/coffee/8
  HTTP/1.1 200 OK
  {"statusCode":200,"data":{"raw":[],"affected":1},"success":true}

  $ curl -i -X DELETE localhost:3990/coffee/8        ← the retry
  HTTP/1.1 404 Not Found
  {"message":"Coffee #8 not found","error":"Not Found","statusCode":404}
  ```

  The *state* is identical either way — coffee 8 does not exist — which is what idempotent means. But a retried delete gets a 404, so a client with naive retry logic reports a failure for an operation that completely succeeded. Some APIs return 204 for both, precisely so a retry looks like a success. Either is fine as long as you decide on purpose and write it down.

#### What a senior does about it: make the retry harmless

You cannot stop clients retrying. Retrying is correct client behaviour; the alternative is losing goals. So the server has to make the second one a no-op. Two ways, and you pick per endpoint.

**(a) Make the operation naturally idempotent — the client names the thing.**

If the client can generate the id, "create" becomes "put this exact thing at this exact address", and POST turns into PUT:

```
PUT /match/77/goal/0f9a1c2e-...     {"player": 9, "minute": 88}
```

Send it five times, the goal is stored once, because you are overwriting the same address. This is the cleanest fix and it is free. Its cost is that ids are now UUIDs invented on a phone rather than tidy auto-increment integers, which some teams dislike.

**(b) Keep POST, add an idempotency key — what Stripe and every payments API do.**

The client generates a random key **once per intended action** (not per attempt), sends it in a header, and reuses it on every retry of that same action:

```
POST /match/77/goal
Idempotency-Key: 0f9a1c2e-4b77-4a15-9f31-2c0e8a7d5b61
{"player": 9, "minute": 88}
```

The server keeps a record of keys it has already honoured. A repeat key does not do the work again — it returns the **first** response.

Measured in the scratch app, first without the key and then with it (2026-09-29):

```
### three plain POSTs — the flaky-network retry
{"id":3,"name":"goal"}
{"id":4,"name":"goal"}
{"id":5,"name":"goal"}
rows now: [{"id":3,...},{"id":4,...},{"id":5,...}]          ← three goals ❌

### three POSTs with the same Idempotency-Key
{"id":6,"name":"goal"}
{"id":6,"name":"goal"}                                       ← same id
{"id":6,"name":"goal"}                                       ← same id
rows now: [{"id":3,...},{"id":4,...},{"id":5,...},{"id":6,...}]   ← one new goal ✅
```

The handler that produced that is about eight lines:

```ts
@Post('idempotent')
createOnce(@Body() dto: CreateGoalDto, @Headers('idempotency-key') key: string) {
  if (!key) throw new ConflictException('Idempotency-Key header required');
  const already = this.seen.get(key);
  if (already) return already;          // the retry gets the FIRST answer, not a new row
  const row = this.doTheWork(dto);
  this.seen.set(key, row);
  return row;
}
```

⚠️ **A `Map` on the service is not the real implementation, and the reason is worth understanding.** It is per-process memory on a singleton (note 04), so it is lost on restart and not shared between two copies of your app behind a load balancer — the two retries can land on different instances and both see an empty map. Worse, two *simultaneous* retries on the same instance both read `undefined` before either writes, and you get the duplicate anyway.

The real version puts the key in the database with a **unique constraint**, so the guarantee is enforced by Postgres, which is the one component that can actually arbitrate between concurrent writers. Run against this repo's Postgres (2026-09-29):

```sql
CREATE TABLE goal_demo (id serial primary key, match_id int, minute int, idempotency_key text UNIQUE);

INSERT INTO goal_demo (match_id, minute, idempotency_key) VALUES (77, 88, 'ref-77-goal-88min');
-- INSERT 0 1

INSERT INTO goal_demo (match_id, minute, idempotency_key) VALUES (77, 88, 'ref-77-goal-88min');
-- ERROR:  duplicate key value violates unique constraint "goal_demo_idempotency_key_key"
-- DETAIL:  Key (idempotency_key)=(ref-77-goal-88min) already exists.

SELECT count(*) AS goals_scored FROM goal_demo;
--  goals_scored
--  ------------
--             1
```

**One goal.** The second insert did not get to choose; the database refused it. Your service catches that error (TypeORM surfaces it as a `QueryFailedError` with Postgres code `23505`) and, instead of turning it into a 500, loads the row that already exists and returns it — so the referee's second tap gets the same successful answer as the first, and the scoreboard stays correct. A unique constraint is the only one of these mechanisms that survives two app instances and two simultaneous requests, which is why it is the one that gets used in production. (Note 12 covers unique indexes, note 11 covers what happens when this is part of a bigger transaction.)

**The names, now that you have seen the thing:** an operation that can be repeated without extra effect is **idempotent**; a client-supplied token that lets a server recognise a repeat is an **idempotency key**; and "my request may have succeeded, I cannot tell" is the **at-least-once delivery** problem, which is the same problem message queues, webhooks and payment gateways all spend their lives on. Any system where retries exist — and retries always exist — eventually grows one of these three fixes.

### Step 6 — Pagination, as a decision rather than as code

Video 12 shows the mechanics: `@Query()`, `limit`, `offset`, `skip`/`take`. **The implementation, the generated SQL and the offset-vs-cursor trade-off are all in [note 10 §5b](10-relations.md) and are not repeated here.** What belongs in a note about API design is the contract.

A list endpoint owes its client three things:

1. **A way to ask for a slice** — `?limit=20&offset=40` for page-numbered admin tables, or `?limit=20&after=<cursor>` for feeds and infinite scroll.
2. **A way to know if there is more** — a `total` (so you can draw "page 3 of 47"), or a `nextCursor` / next link (so you can draw "load more"). Without one of these the client cannot tell "that was the last page" from "that page happened to be short", and ends up polling for an empty page every time.
3. **A cap, applied by the server.** `?limit=1000000` must not work.

And the rule that turns this from style into safety: **"no parameters" must never mean "the entire table".** Here is `GET /coffee` with no query string at all, on the real app:

```
$ curl -i localhost:3990/coffee
HTTP/1.1 200 OK
Content-Length: 468
{"statusCode":200,"data":[ ...every row in the table... ],"success":true}

$ curl -s -o /dev/null -w 'status=%{http_code} size=%{size_download}\n' "localhost:3990/coffee?limit=999999"
status=200 size=468
```

Both return everything, because `skip: undefined, take: undefined` at `src/coffee/coffee.service.ts:107` is TypeORM's way of saying "no limit". With six rows that is invisible; with two million it is one request that loads the whole table into memory while every other user waits behind it on the one thread (note 04). The fix is a default on the DTO, not a check in the handler — a default (`limit = 20`) and a maximum (`@Max(100)`), so that forgetting to paginate is impossible rather than merely discouraged.

⚠️ And there is a live bug in this repo, which shows the other half of the contract — what your *validation* promises. Measured:

```
$ curl -i "localhost:3990/coffee?limit=5&offset=0"
HTTP/1.1 400 Bad Request
{"message":["offset must be a positive number"],"error":"Bad Request","statusCode":400}
```

**The very first page is a 400.** `@IsPositive()` on `offset` at `src/common/dto/pagination-query.dto.ts:30` means "greater than zero", and `offset=0` is the most common value any client will ever send. Any frontend written the obvious way — start at offset 0, add `limit` each time — fails on its first request. `@Min(0)` is the fix. Note 10 §5b flagged this; here it is happening.

### Step 7 — What the URL itself should look like

A URL names a **thing**, and the method says what you are doing to it. Once you hold that, most URL arguments answer themselves.

```
❌ POST /getAllCoffees          ❌ POST /createCoffee          ❌ POST /deleteCoffee?id=3
✅ GET  /coffee                 ✅ POST /coffee                ✅ DELETE /coffee/3
```

`/getAllCoffees` is not merely ugly. It puts the verb in the noun, so you need a new URL for every operation, and the method stops carrying information — which means all the machinery from step 5 stops working. A proxy cannot cache `POST /getAllCoffees`, a client cannot safely retry it, and a browser will warn before repeating it, all because you told HTTP it was a creation when it was a read. The convention pays for itself in behaviour you get for free, not in tidiness.

Three practical points:

- **Nest nudges you here already.** `@Controller('coffee')` names the resource once and each method decorator supplies the verb. `src/coffee/coffee.controller.ts` reads as five things done to one noun, which is what you want.
- **Singular vs plural: pick one and never mix.** This repo uses `/coffee` and `/user`, both singular. The wider convention is plural (`/coffees`, `/users`), and the official course uses `/coffees`. Singular is **completely fine** — what is not fine is `/coffee` next to `/users`, because then every frontend developer has to guess, every time, and will get it wrong about half the time. Consistency beats convention here. (If you do switch later, that is a breaking change for every client, which is its own lesson about how early these decisions harden.)
- **Nouns, with one pragmatic exception.** Real actions that are not CRUD on a row — `POST /coffee/1/recommend`, `POST /match/77/start`, `POST /user/2/reset-password` — do not fit the noun rule, and the purist workarounds (inventing a `/recommendation` resource to POST to) are usually worse to read than the verb. Use the verb, keep it as a sub-path of the resource it acts on, keep it `POST`, and be aware you have just created a non-idempotent endpoint that step 5 applies to.

Nesting follows the same idea: `/match/77/goal` says "the goals belonging to match 77", which is a real thing. Past two levels (`/tournament/3/match/77/goal/12/comment/4`) it stops helping, and the usual move is to give the deep resource its own top-level URL (`/goal/12/comment`).

## 4. How it works underneath

Nest's status-code "magic" is two lines. From `node_modules/@nestjs/core/router/router-execution-context.js:78`:

```js
const httpCode = this.reflectHttpStatusCode(callback);                       // line 78
const httpStatusCode = httpCode ?? this.responseController.getStatusByMethod(requestMethod);
```

`reflectHttpStatusCode` is one line (`:98`), and it reads exactly the kind of sticky label you met in note 16:

```js
reflectHttpStatusCode(callback) {
  return Reflect.getMetadata(HTTP_CODE_METADATA, callback);
}
```

...which is there because `@HttpCode` put it there. The whole decorator, from `@nestjs/common/decorators/http/http-code.decorator.js`:

```js
export function HttpCode(statusCode) {
  return (target, key, descriptor) => {
    Reflect.defineMetadata(HTTP_CODE_METADATA, statusCode, descriptor.value);
    return descriptor;
  };
}
```

And the default, from `router/router-response-controller.js:35`:

```js
getStatusByMethod(requestMethod) {
  switch (requestMethod) {
    case RequestMethod.POST:
      return HttpStatus.CREATED;      // 201
    default:
      return HttpStatus.OK;           // 200
  }
}
```

That is the entire feature. There is no inspection of your return value, no cleverness about whether a row was created. `@HttpCode(204)` writes a number onto the method function at import time; at request time Nest reads it, and falls back to a `switch` with two cases. You could have written both files.

Written as the plain JS this corresponds to:

```js
// at startup, once per route
const statusForThisRoute = handler.__httpCode ?? (method === 'POST' ? 201 : 200);

// per request
async function run(req, res) {
  const result = await handler(...buildArgs(req));   // pipes built the args (note 07)
  res.status(statusForThisRoute).json(result);       // ← the number was decided long before
}
// ...and if handler() throws, none of this runs: the filter picks the status instead (note 05)
```

The flow for one request, with the files:

```
DELETE /coffee/8
  │
  ├─ Express matches the route                    no match → 404 "Cannot DELETE /coffee/8"
  │                                                (measured: PUT /coffee/7 → 404, no PUT route exists)
  ├─ guards → interceptors(before) → pipes        note 16's order
  │     ParseIntPipe: "8" → 8                     "abc" → throws → 400 (measured)
  │
  ├─ handler          src/coffee/coffee.controller.ts:77
  │     └─ service    src/coffee/coffee.service.ts:128
  │           findOne → null? → throw NotFoundException   ──┐
  │           delete(id) → { raw: [], affected: 1 }        │
  │                                                         │
  ├─ status chosen:  @HttpCode? no → method is DELETE → 200 │
  ├─ interceptor(after) wraps → {statusCode, data, success} │
  └─ res.status(200).json(...)                              │
                                                            └─► filter → 404 (note 05)
```

Two things fall out of that picture that are easy to miss:

1. **The status for the success path was decided before your handler ran.** It is a property of the route, not of the result.
2. **The error path never reaches that code at all.** A thrown exception skips the status-selection line entirely and gets its number from the exception object. That is why `@HttpCode` and exception classes never fight: they are on two different branches.

## 5. The Express way vs the Nest way

There is no class-versus-function question in this note — a status code is a number, not an object. The comparison that matters is between writing the response yourself and letting the framework write it.

**Express, by hand — the way you'd have written this before Nest:**

```js
app.post('/coffee', async (req, res) => {
  const coffee = await createCoffee(req.body);
  res.status(201).json(coffee);                 // ← you type the number
});

app.get('/coffee', async (req, res) => {
  const list = await findAll(req.query);
  res.status(200).json(list);                   // ← and again
});

app.delete('/coffee/:id', async (req, res) => {
  const found = await findOne(req.params.id);
  if (!found) return res.status(404).json({ message: 'not found' });
  await remove(req.params.id);
  res.status(204).end();                        // ← and again, and .end() not .json()
});
```

**Nest:**

```ts
@Post()               create(@Body() dto: CreateCoffeeDto) { return this.service.create(dto); }   // 201
@Get()                findAll(@Query() q: PaginationQueryDto) { return this.service.findAll(q); } // 200
@Delete('/:id') @HttpCode(HttpStatus.NO_CONTENT)
                      deleteById(@Param('id', ParseIntPipe) id: number) { return this.service.deleteById(id); }
```

| | Express by hand | Nest's "return a value" |
|---|---|---|
| Who picks the status | you, in every handler | the method's default, unless you override it |
| Consistency across 40 routes | depends on 40 people remembering; one route quietly returns 200 for a creation | uniform by construction; an override is one visible decorator |
| Reading a handler | you can see the status without leaving the function | you have to know the default rule (POST→201, else 200) |
| Errors | `res.status(404)` typed by hand in each route, in whatever shape that route's author liked | `throw` once, anywhere in the call stack, one filter decides the shape (note 05) |
| Unusual responses | trivial: set headers, stream, redirect, send a file, write chunks | you step outside with `@Res()`, and pay for it — see below |
| Testing | you must fake `req` and `res` and assert on `res.status` calls | the handler returns a value; a unit test asserts on the value |

**What Nest's way costs, and it is a real cost:** the status is not in the function you are reading. `create()` says nothing about 201. Six months in you either remember the rule or you go looking, and a reviewer cannot see from the diff that a new POST route now returns 201. The mitigation is knowing the rule (it is two cases) and writing `@HttpCode` explicitly wherever the answer is not obvious — 204 on DELETE being the main one.

**And the escape hatch, which video 10 spends half its time on: `@Res()`.** Nest lets you take the raw Express response object and drive it yourself:

```ts
@Get()
findAll(@Res() response) {
  response.status(200).send('...');     // you are back in Express
}
```

The video demonstrates it and then tells you to revert it, which is the right advice for the wrong-sounding reason. The real cost is that the moment you take `@Res()`, **you leave the Nest pipeline**. Nest no longer knows what your handler produced, so:

- `@HttpCode` stops applying — you're setting the status yourself now.
- **Interceptors stop being able to touch the response.** In this repo that means `TransformInterceptor` (`src/main.ts:69`) silently stops wrapping that one route, and the frontend gets a bare body from one endpoint and `{statusCode, data, success}` from every other. Nobody will notice until it breaks.
- Your handler becomes Express-specific, so swapping to Fastify breaks it.
- Tests now need a fake response object instead of just reading a return value.

There is a middle option the course doesn't mention and that is worth knowing: `@Res({ passthrough: true })` gives you the response object **for setting headers or a cookie** while still letting Nest handle the body and the status from your return value. That's the one you want for "I need to set one header", which is the actual requirement 90% of the time.

## 6. In my project

| What | Where | State |
|---|---|---|
| `@Post()` → 201 by default | `src/coffee/coffee.controller.ts:57` | ✅ correct, nothing to do |
| `@Get()` → 200 by default | `src/coffee/coffee.controller.ts:39`, `:45` | ✅ correct |
| `@Patch('/:id')` → 200 | `src/coffee/coffee.controller.ts:68` | ✅ correct method for what it does |
| `@Delete('/:id')` → 200 + `DeleteResult` | `src/coffee/coffee.controller.ts:76` | ❌ should be `@HttpCode(204)` |
| `deleteById` returns `repo.delete(id)` | `src/coffee/coffee.service.ts:136` | ❌ leaks `{raw:[],affected:1}`; return nothing, or the deleted coffee |
| `updateById` returns `save(coffee)` | `src/coffee/coffee.service.ts:168` | ✅ already fixed — returns the coffee, not `UpdateResult`. The ⚠️ comment above it at `:163` is stale and describes the old code |
| `@Put('/:id')` that behaves like PATCH | `src/user/user.controller.ts:139` | ❌ **the one real bug in this list** — see below |
| `find({ skip, take })` with no default or cap | `src/coffee/coffee.service.ts:107` | ❌ no parameters returns the whole table |
| `@IsPositive()` on `offset` | `src/common/dto/pagination-query.dto.ts:30` | ❌ rejects `offset=0`, the first page (measured 400) |
| Stale `TO DO` comment claiming `@Patch`/`@Delete` are missing | `src/coffee/coffee.controller.ts:62`–`66` | ⚠️ they are implemented four lines below it |

**The `@Put` at `src/user/user.controller.ts:139`.** The route says PUT, which promises the client "send me the complete user and I will store exactly that". What it actually does, via `updateUser` at `src/user/user.service.ts:167`, is copy over only the fields that were sent:

```ts
if (dto.name !== undefined) user.name = dto.name;
if (dto.email !== undefined) user.email = dto.email;
```

That is PATCH behaviour wearing a PUT label. Measured on the real app, against user 4 (`{id:4, name:"Saim", email:"saim@example.com"}`):

```
$ curl -X PUT localhost:3990/user/4 -d '{"name":"Renamed"}'     # no email in the body
status=200

$ curl localhost:3990/user/4
{"statusCode":200,"data":{"id":4,"name":"Renamed","email":"saim@example.com"},"success":true}
                                                    ↑ still there
```

A client that reads your API as HTTP will send a PUT expecting the email to be cleared, because that is what PUT means, and will be quietly wrong. Worse, if you ever "fix" the service to do a true replace, every existing caller that sends partial bodies starts silently deleting fields. The honest fix is one word: change `@Put` to `@Patch` (and the import), because PATCH is what this code has always done. The comment at `:136` already says so.

**Other measured behaviour of the app today** (all 2026-09-29, `PORT=3990`):

```
GET  /coffee/999         → 404 {"message":"Coffee #999 not found","error":"Not Found","statusCode":404}
GET  /coffee/abc         → 400 {"message":"Validation failed (numeric string is expected)",...}
GET  /does-not-exist     → 404 {"message":"Cannot GET /does-not-exist",...}
PUT  /coffee/7           → 404   (no PUT route is registered on CoffeeController)
POST /coffee  {"name":"X","brand":"Y","isAdmin":true}
                         → 400 {"message":["property isAdmin should not exist"],...}
PUT  /user/999 {"name":"Ghost"} → 404 {"message":"User with ID \"999\" not found",...}
PUT  /user/999 {"name":"x"}     → 400 {"message":["Name must be at least 3 characters long"],...}
```

That last pair is note 16's ordering lesson showing up in status codes: the pipe runs before the handler, so a too-short name gets 400 and the "does this user exist" check never runs. Both are 4xx, both are correct, and which one you get depends on which layer objects first.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Return an error body with a 200 status (your own `getUserById` bug, note 05 §1) | `res.ok` is true, so `if (!res.ok)` never fires and the UI renders the error object as data. Monitoring counts it as a success, so the error graph stays flat. Proxies may cache the "failure" | The user staring at `undefined`; on-call, who is never paged because nothing looks wrong |
| 500 for bad input | The client is told "our fault, try again" and retries something that can never succeed. Every user typo becomes an alert | On-call, woken at 3am by someone mistyping an email |
| 403 where 404 is right (or the reverse) | 403 confirms that `/tournament/secret-signing-2027` exists to someone not allowed to see it. 404 for a permission problem sends a logged-in user to the login screen and back, forever | The person whose private resource was confirmed to exist; the user stuck in a redirect loop |
| POST used for an update | You give up idempotency for no reason: a retried "update" is no longer known-safe, caches can't reason about it, and the URL usually grows a verb to match | Whoever debugs the duplicate side-effects a year later |
| Retry a non-idempotent call (or let a client library do it for you) | Two rows, two goals, two charges. Measured above: the same POST twice produced coffee 7 **and** coffee 8 | The referee whose match now shows 2–0; the customer charged twice |
| Return `DeleteResult` / `UpdateResult` from a handler | `{"raw":[],"affected":1}` becomes your public contract; the day you change ORM, it changes shape and clients break. Meanwhile 200 claims there is content when there isn't | The frontend developer who has to learn TypeORM to read your API |
| No cap or default on page size | `?limit=1000000` — or no parameters at all — loads the whole table into memory on the single thread, and everyone else queues behind it (note 04) | Every other user of the app during those seconds; the database |
| `@IsPositive()` on an offset | `offset=0` — the first page — returns 400 (measured). Every correctly-written client fails on its first request | Whichever frontend developer integrates first and assumes their own code is wrong |
| 201 for something that wasn't created | Clients that follow the `Location` header get a 404; anything keyed on "was something created" miscounts | Whoever builds on the assumption; your own analytics |
| `@Res()` to set one header | The route leaves the Nest pipeline: `TransformInterceptor` silently stops wrapping it, so one endpoint has a different response shape from all the others | The frontend, whose one shared unwrapper breaks on exactly one route |
| 429 with no `Retry-After` | Clients don't know how long to wait, so they retry immediately and make the overload worse | Your server, during the incident that made you add rate limiting |
| Verbs in URLs (`POST /getAllCoffees`) | The method no longer describes the operation, so caching, safe retries and browser behaviour all stop working — a read is now un-cacheable and un-repeatable | Performance; and the next developer, who cannot guess any URL in your API |

## 8. 🧠 Senior engineer lens

- **The status code is a contract with machines, not a message to humans.** Retry logic, caches, CDNs, load balancers, circuit breakers and dashboards all branch on it, and none of them read your body. Choosing 500 over 400 doesn't just mislabel an event; it changes what a dozen automated systems do next.
- **The 4xx/5xx line is the retry line.** That is the practical meaning of the split. Before choosing a code, ask "should the caller try this again?" If yes, it's a 5xx (or a 429 with `Retry-After`). If no, it's a 4xx. Getting this backwards either hides real outages or generates infinite pointless traffic.
- **Idempotency is a design property, not a feature you add later.** Every distributed system delivers at least once, because a client that can't tell "lost request" from "lost response" must retry to be correct. So the server must be built so the second delivery is harmless. Retrofitting that onto an endpoint that has been creating duplicate rows for a year means writing a deduplication script against data where you can no longer tell a real duplicate from a retry.
- **Enforce uniqueness in the database, not in the service.** An in-memory check is a read followed by a write with a gap in between, and under concurrency two requests both pass the read. A unique constraint is the one place the decision is arbitrated by something that sees all writers (note 11, note 12). The application layer's job is to catch the constraint error and turn it into a sensible 409 or a replayed success instead of a 500.
- **Every field you put in a response is a promise.** `{"raw":[],"affected":1}` leaked a library's internals into a public contract by accident. The question before returning anything is "am I willing to keep sending this for three years?" — because removing a field from a response is a breaking change even when nobody asked for it.
- **Status codes are where security leaks hide.** 404-vs-403 tells strangers which resources exist. A 401 on `/coffee` and a 404 on `/does-not-exist` lets someone map your routes (note 16 Part B step 4 measures exactly that). Differences in *timing* between codes leak too. None of this is usually fatal; all of it should be a decision rather than an accident.
- **Consistency beats correctness at the edges.** Whether you use 400 or 422 for a semantic error, singular or plural URLs, 200-with-body or 204 for DELETE — pick one, write it in a document, and apply it everywhere. A frontend team can work with any consistent convention. What costs them real hours is an API where a third of the endpoints do it differently.
- **These conventions are load-bearing for tools you haven't used yet.** OpenAPI (note 18) documents status codes per route; client generators turn 4xx into typed errors; API gateways retry on 5xx and not on 4xx; browsers cache GETs and refuse to silently repeat POSTs. Following the convention buys you all of that behaviour without writing any of it.

## 9. 🔗 Connects to

- [05 — Exception filters](05-exception-filters.md) — **the error half of this note.** Which exception class produces which 4xx/5xx, what the bodies look like, and the 200-with-error-body bug in full
- [07 — Pipes & validation](07-pipes-validation.md) — where the 400s come from, and why bad input is the caller's fault and not a 500
- [10 — Relations §5b](10-relations.md) — pagination implemented: `skip`/`take`, the generated SQL, offset vs cursor
- [06 — Interceptors](06-interceptors.md) — the `{statusCode, data, success}` envelope wrapped around every body above, and why `@Res()` bypasses it
- [16 — Building blocks & guards](16-building-blocks-and-binding.md) — 401 vs 403 from the guard's side, and why a pipe's 400 beats a handler's 404
- [11 — Transactions](11-transactions.md) and [12 — Indexes & migrations](12-indexes-migrations.md) — the unique constraint that makes an idempotency key real
- [04 — Requests, shared state, the event loop](04-requests-shared-state-event-loop.md) — why an uncapped page size stalls every other user, and why a `Map` on a singleton is not a safe ledger
- **Often confused with:** the `statusCode` field *inside* the body (that's your interceptor's copy) versus the real one on the status line — only the second one anything automated reads
- **Next:** note 18 (OpenAPI), where these codes become the documented contract, and the tournament API, where idempotency stops being theory

## 10. ✍️ In my own words

> _(mine to write)_

## 11. 🛠️ Practice

1. **Make DELETE honest.** Give `src/coffee/coffee.controller.ts:76` a 204 and stop `src/coffee/coffee.service.ts:136` returning `DeleteResult`. Then `curl -i` it and check three things: the status line, whether there is a `Content-Length` header, and how many bytes came back.

   <details><summary>Hints</summary>

   - `@HttpCode(HttpStatus.NO_CONTENT)` — both imports come from `@nestjs/common`.
   - The service currently `return`s the repository call. What should it return instead, given that nothing will be sent?
   - `curl -s -o /dev/null -w 'status=%{http_code} size=%{size_download}\n'` prints the size without the noise.
   - ⚠️ Before you finish, check what your `TransformInterceptor` does on this route now. Does it still run? Does anything of its envelope survive? The answer is in section 3 step 3.
   </details>

2. **Fix the PUT.** Change `src/user/user.controller.ts:139` so the method matches what the code does. Then write down what you would have had to change if you'd decided to make it a *true* PUT instead, and who that would have broken.

   <details><summary>Hints</summary>

   - One decorator and one import. The comment at `:136` already told you.
   - For the "true PUT" version: `UpdateUserDto` is a `PartialType`, which is exactly the wrong shape for a replace. Why?
   - A true PUT with a partial body has to clear the missing fields. Try it on user 4 and see what that does to `email`.
   </details>

3. **Reproduce the duplicate, then stop it.** Send `POST /coffee` twice with the same body and confirm two rows (you'll get this in about ten seconds). Then add an `Idempotency-Key` header, a column with a `UNIQUE` constraint, and make the second call return the first call's answer instead of a 500.

   <details><summary>Hints</summary>

   - `@Headers('idempotency-key')` in the handler signature gives you the header, the same way `@Body()` gives you the body (note 17 Part B).
   - Do **not** check "does this key exist?" and then insert. Under two simultaneous requests both checks pass. Let the `INSERT` fail and catch it.
   - TypeORM throws `QueryFailedError`; Postgres's unique-violation code is `23505`, on `err.driverError.code`. Note 05 §3.6 shows how to catch a non-`HttpException` and turn it into a proper response.
   - What should the retry actually return — the stored row with 201, a 200, or a 409? Decide, and write down why.
   </details>

4. **Fix the pagination contract.** Make `offset=0` work, give `limit` a default and a maximum, and add the count the client needs to render "page 3 of 47".

   <details><summary>Hints</summary>

   - `@Min(0)` and `@Max(100)` from class-validator; a plain `= 20` on the DTO property is your default, and it only applies because `transform: true` is on at `src/main.ts:56`.
   - For the count, TypeORM has `findAndCount`, which returns `[rows, total]`. Ask yourself what that costs — it is a second query over the whole matching set.
   - Then design the response shape. `{ items, total, limit, offset }` versus a bare array: which one can you add to later without breaking clients?
   </details>

5. **Design the tournament endpoints before you write them.** On paper, for: create a match, start it, record a goal, correct a goal that was wrongly awarded, delete a match. For each one give the method, the URL, the success status, and the answer to "what happens if this arrives twice?"

   <details><summary>Hints</summary>

   - "Start the match" is the one that doesn't fit the noun rule. Section 3 step 7 says what to do about it — and once you've done it, ask whether starting a match twice is harmless.
   - "Correct a goal" — is that a PATCH on the goal, a DELETE plus a POST, or something else? Think about what an audit trail needs afterwards.
   - Which of your five endpoints needs an idempotency key, and which ones are naturally safe? Write the reason next to each, not just the answer.
   - Walk `notes/how-to-think-before-building.md` for the file-by-file order before you create anything.
   </details>

6. **See the whole surface at once.** Write a small script that curls every route in the app with a good request, a malformed request and a missing id, and prints a table of method, path and status. Then look down the status column and find the ones that surprise you.

   <details><summary>Hints</summary>

   - `curl -s -o /dev/null -w '%{http_code}'` is the whole measuring part.
   - Include a route that doesn't exist and a method that isn't registered — `PUT /coffee/7` was a 404 above. Is 404 the right answer for "this path exists but not with that method"? Look up 405 and decide whether you care.
   </details>

## 12. ❓ Quiz

**Q1.** A referee's phone sends `POST /match/77/goal` on bad wifi. The server writes the goal, but the response is lost, so the client library retries the identical request. The handler has no bugs. What is in the database, and what is the underlying property that decides it?

- A) One goal — HTTP de-duplicates identical requests within a short window
- B) Two goals. POST means "create a new one", so being asked twice creates twice. The property is **idempotency**: repeating a request must not change the result beyond the first time, and POST does not have it. The fixes are a client-generated idempotency key enforced by a unique constraint, or moving to a `PUT` at a client-chosen id
- C) One goal, because the second request will fail validation
- D) Two goals, but only if the two requests arrive at the same instance

<details><summary>Answer</summary>

**B**, and this was measured on the real app on 2026-09-29 — the same `POST /coffee` body sent twice produced coffee `id:7` and coffee `id:8`, both `201 Created`, both visible in `GET /coffee`.

**A is worth arguing with**, because it's what people assume: nothing in HTTP de-duplicates anything. The method *describes* whether repetition is safe; it does not *make* it safe. **D is a tempting half-truth** — the instance doesn't matter for the duplicate (both requests do the work wherever they land), but it matters enormously for the *fix*: an in-memory `Map` of seen keys only works on one instance, which is why the guarantee belongs in the database. Measured there too:

```
INSERT ... 'ref-77-goal-88min'  → INSERT 0 1
INSERT ... 'ref-77-goal-88min'  → ERROR: duplicate key value violates unique constraint
SELECT count(*)                 → 1
```

</details>

**Q2.** You're writing a client for an endpoint that may be retried automatically by a flaky mobile network. You control the API. Which method should the endpoint use, and why is the answer not "whichever fits the operation"?

- A) POST, because it's the most flexible and can carry any body
- B) GET, because it's safe
- C) **PUT**, at an address the client chooses. PUT means "store exactly this here", so the tenth delivery leaves the same state as the first — measured: three identical PUTs produced one row. The operation can almost always be reshaped into a replace-at-a-known-address, and doing so is what makes the retry harmless. GET is safe but cannot write; POST is the one method explicitly not idempotent
- D) PATCH, because it only changes the fields you send

<details><summary>Answer</summary>

**C.** The trick in the question is that the method isn't only a label for what you're doing — it's the promise you make about repetition, so when retries are part of the design, you *choose the operation's shape to fit the method you need*. "Create a goal with a server-generated id" becomes "put this goal, whose id the client generated, at this address", and the retry problem disappears without any ledger, any key and any extra table.

**D is the sharpest wrong answer.** PATCH is not idempotent in general — the spec doesn't promise it and your code decides. `{"name":"x"}` is a replace of one field and is safe; `{"goals": {"$inc": 1}}` or anything that appends is not. Saying "PATCH is idempotent" is a claim about a particular handler, never about the method.

</details>

**Q3.** Your `ValidationPipe` rejects `POST /user` with `{"name":"x"}` because the name is too short. A teammate suggests returning 500 "so it shows up in our alerting and we notice bad clients". What actually happens if you do?

- A) Nothing much; the client sees an error either way
- B) It's better — real monitoring of client problems
- C) Three things break at once. Clients treat 5xx as retryable, so a typo becomes a retry storm against an endpoint that can never succeed. Your error-rate dashboard — which counts 5xx — now fires for user typos, so on-call gets paged at 3am for someone mistyping an email, and real outages get buried in that noise. And the client is told "our fault", so it never shows the user the message that would let them fix it
- D) It only matters if you have a CDN

<details><summary>Answer</summary>

**C.** The 4xx/5xx boundary is the retry boundary and the alerting boundary at the same time, which is why it is the single most consequential choice in this note. The measured, correct behaviour of your app today:

```
PUT /user/999 {"name":"x"} → 400 {"message":["Name must be at least 3 characters long"],...}
```

400, the message names the offending field, no retry is implied and nobody's phone buzzes. **B's underlying wish is legitimate** — you *should* watch 4xx rates, because a sudden spike means a client shipped a bug. Watch them on their own graph, with their own (much lower priority) alert. Note 05's table puts it as "log 5xx loudly, 4xx quietly".

</details>

**Q4.** `DELETE /coffee/8` returns `200 {"statusCode":200,"data":{"raw":[],"affected":1},"success":true}` today. Which statement about changing it to 204 is correct?

- A) You must also `return;` from the service, or the client will still receive `{"raw":[],"affected":1}` alongside the 204
- B) The handler can keep returning whatever it likes — Express strips the body for a 204 (`lib/response.js:202` removes `Content-Type`, `Content-Length` and the chunk), so the client gets zero bytes. The reason to fix the service anyway is that `DeleteResult` is a library internal that has no business being in your contract, and the day you change ORM the shape changes under your clients
- C) 204 isn't allowed on DELETE; 200 is the only correct answer
- D) Nest will throw at startup if a handler with `@HttpCode(204)` returns a value

<details><summary>Answer</summary>

**B**, measured. The scratch handler decorated `@HttpCode(HttpStatus.NO_CONTENT)` returned `{ affected: 1 }`, and the response was:

```
HTTP/1.1 204 No Content
X-Powered-By: Express
(no Content-Type, no Content-Length)
status=204 size=0
```

**A is the answer most people give and it is wrong about the mechanism while being right about the advice** — which is the interesting part. You should still fix the service, but not because the body would leak; because sending a value that is silently discarded means the next person reading `deleteById` has no idea what the route actually returns. ⚠️ One consequence worth carrying: a frontend calling `res.json()` on a 204 gets `SyntaxError: Unexpected end of JSON input`, so switching to 204 is a breaking change for any client that parses the body.

</details>

**Q5.** `GET /coffee?limit=5&offset=0` returns `400 {"message":["offset must be a positive number"]}`. `GET /coffee` with no parameters returns 200 and every row in the table. What single sentence describes both bugs?

- A) The DTO is missing `@IsOptional()`
- B) Both come from treating pagination parameters as optional decoration rather than as the contract. `@IsPositive()` rejects `0`, which is the first page every correct client asks for, so the happy path is a 400; and because nothing supplies a default, absent parameters mean `skip: undefined, take: undefined`, which TypeORM reads as "no limit". The rule is that **"no parameters" must never mean "the whole table"**, and the boundary values — 0 and absent — are the ones to test
- C) `transform: true` isn't set, so `"0"` stays a string and fails the check
- D) Only the second is a bug; rejecting `offset=0` is correct because offsets start at 1

<details><summary>Answer</summary>

**B.** Both measured on 2026-09-29:

```
GET /coffee?limit=5&offset=0  → 400 {"message":["offset must be a positive number"],...}
GET /coffee                   → 200, Content-Length: 468 — the entire table
GET /coffee?limit=999999      → 200, 468 bytes — the entire table again
```

**C is a good guess and checkably wrong**: `transform: true` *is* set at `src/main.ts:56` and `@Type(() => Number)` is on the property, so `"0"` really does become the number `0` — and then `@IsPositive()` rejects it, because 0 is not positive. The conversion working is what makes the bug visible. `@Min(0)` for offset, `@Min(1) @Max(100)` and a default for limit. Note 10 §5b predicted both.

</details>

**Q6.** You're designing `/tournament` endpoints. A teammate proposes `POST /getTournamentStandings` (a read that takes a complex filter body) and `POST /deleteMatch?id=3`. Beyond style, what concretely stops working?

- A) Nothing; both work fine and the body is more flexible than a query string for complex filters
- B) The method stops describing the operation, and everything downstream reads the method rather than the URL. `POST /getTournamentStandings` cannot be cached by a browser, a CDN or a proxy, cannot be safely retried by a client library, and makes the browser warn on reload — for a read. `POST /deleteMatch?id=3` is worse: it advertises itself as non-idempotent, so a retried delete looks dangerous when it is the one operation that is genuinely repeatable. `GET /tournament/3/standings` and `DELETE /match/3` get all that behaviour for free
- C) Nest can't route a POST with a query parameter
- D) It only matters for public APIs

<details><summary>Answer</summary>

**B.** The convention is load-bearing rather than decorative: caches, retry policies, browsers and gateways all branch on the method, so putting the verb in the URL throws away behaviour you would otherwise get without writing a line.

**A contains a real point worth conceding**, and seniors hit it: a genuinely complex search filter does not fit in a query string, and the pragmatic industry answer is `POST /tournament/standings/search` — a POST that reads. You give up caching knowingly, you name it so nobody mistakes it for a write, and you write down why. That is a trade-off made on purpose, which is a completely different thing from `POST /getAllCoffees`.

</details>
