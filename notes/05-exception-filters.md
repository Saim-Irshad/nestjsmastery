# 05 — Exception Filters

> 📍 **Where on the Big Map:** the red ✖ path. If a guard, interceptor, pipe, controller or service **throws**, the filters decide what error response the client gets.
> 🎥 **Video:** 00:30:23 – 00:33:21

## 1. The problem (why this exists)

Our old code:

```ts
getUserById(id: string) {
  const user = this.users.find(...);
  if (user) return user;
  return { message: 'User not found' };   // ❌
}
```

What the client receives:

```
HTTP/1.1 200 OK                          ← "success!"
{ "message": "User not found" }
```

As a frontend dev you know the pain:
```js
const res = await fetch('/user/999');
if (!res.ok) showError();     // never runs, status is 200
setUser(await res.json());    // user = { message: 'User not found' } 💥 UI renders garbage
```
Monitoring also counts it as a success, caches may store it, and every endpoint invents its own error shape.

**What we want:** throw an error anywhere, and get a **correct status code** and a **consistent error shape** automatically.

## 2. Mental model

Frontend link: **exception filters are React Error Boundaries for your API.**

```
React:  a component deep in the tree throws → bubbles up → nearest ErrorBoundary renders fallback UI
Nest:   a service deep in the call chain throws → bubbles up → nearest exception filter sends an error response
```

Throwing means "stop everything and go up the call stack until someone catches this".
You don't need `try/catch` in every controller, because Nest has one big catch around the whole pipeline.

## 3. How it works behind the scenes

### 3.1 Nest wraps your handler in a try/catch

```js
// what Nest does for every route (simplified)
expressApp.get('/user/:id', async (req, res) => {
  try {
    // guards → interceptors → pipes → handler → interceptors
    const result = await userController.getUserbyId(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    const filter = findMatchingFilter(err);   // route → controller → global → built-in
    filter.catch(err, host);                  // host gives access to req/res
  }
});
```

### 3.2 The call-stack bubble

```
UserController.getUserbyId('999')
   └─ UserService.getUserById('999')
         └─ throw new NotFoundException('User with ID "999" not found')
               │
               ▲ unwinds: service stops, controller stops, nothing after the throw runs
               │
         Nest's catch → built-in filter → res.status(404).json(...)
```

### 3.3 The built-in filter

For `HttpException` (and subclasses):
```json
{ "message": "User with ID \"999\" not found", "error": "Not Found", "statusCode": 404 }
```

For **anything else** (`throw new Error('db exploded')`, a `TypeError`, etc.):
```json
{ "statusCode": 500, "message": "Internal server error" }
```
The real message is **hidden** on purpose, so the client doesn't learn about your infrastructure. It's logged on the server.

### 3.4 Built-in exceptions to know

| Exception | Status | Use when |
|---|---|---|
| `BadRequestException` | 400 | Input is invalid (pipes throw this automatically) |
| `UnauthorizedException` | 401 | **Not logged in** / token missing or invalid ("who are you?") |
| `ForbiddenException` | 403 | Logged in but **not allowed** ("I know you, but no") |
| `NotFoundException` | 404 | Resource doesn't exist |
| `ConflictException` | 409 | Clashes with current state (email already taken) |
| `UnprocessableEntityException` | 422 | Well-formed but semantically invalid |
| `InternalServerErrorException` | 500 | Our fault |

4xx = **client's** fault (they can fix the request). 5xx = **server's** fault (retrying might help; someone should get paged).

### 3.5 A custom filter (a consistent error shape for the whole API)

```ts
@Catch(HttpException)                                   // which errors this filter handles; @Catch() = everything
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();                    // host works for HTTP, WebSockets, microservices
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const status = exception.getStatus();

    res.status(status).json({
      success: false,
      statusCode: status,
      message: exception.message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

Three ways to attach it:
```ts
@UseFilters(HttpExceptionFilter)   // on one method or a whole controller
app.useGlobalFilters(new HttpExceptionFilter());   // main.ts: global, but YOU call `new` → no DI
{ provide: APP_FILTER, useClass: HttpExceptionFilter }  // in a module's providers: global + DI works
```

## 4. In our project

[src/user/user.service.ts](../src/user/user.service.ts) now throws `NotFoundException` instead of returning `{ message }` with 200.
Try: `curl -i localhost:3000/user/999` and look at the **status line**, not only the body.

Notice the pairing coming next: our `TransformInterceptor` wraps **successes** as `{ success: true, statusCode, data }`.
A custom filter can shape **errors** as `{ success: false, statusCode, message }`. Together: **one predictable response contract** for the frontend.

## 5. ❌ How NOT to do it

| Don't | Why it hurts |
|---|---|
| Return error objects with status 200 | Frontend `res.ok` lies; monitoring/alerts blind; caches store errors |
| `try/catch` in every controller just to re-throw or `res.status()` | Noise; inconsistent shapes; that's the filter's job |
| `catch (e) { return null; }` (swallowing) | The bug disappears silently; hours of debugging later |
| Send `err.stack`, SQL errors or internal hostnames to the client | Leaks your internals to attackers |
| Use 500 for user mistakes (bad input) | Wakes up on-call for a typo; clients retry things that will never succeed |
| Use 401 when you mean 403 | Frontend redirects a logged-in user to the login page in a loop |
| Log every 404 as an ERROR | Real problems get lost in noise. Log 5xx loudly, 4xx quietly. |

## 6. 🧠 Senior engineer lens

- **Errors are part of your API contract.** Frontend and mobile teams code against them. Add a stable machine-readable `code`
  (`"USER_NOT_FOUND"`). Messages change and get translated; codes don't.
- **HTTP exceptions inside services are a trade-off.** `NotFoundException` in `UserService` ties business logic to HTTP.
  If a cron job or queue worker calls the same method, "404" means nothing there.
  Bigger codebases throw **domain errors** (`UserNotFoundError`) and one filter maps them to HTTP. Small apps often accept the coupling.
  Know that you're making a choice.
- **Errors that escape the pipeline don't reach filters.** Fire-and-forget promises (not awaited) that reject become
  **unhandled rejections**, and by default modern Node **crashes the process**, taking every user's in-flight request with it (see Q3).
- **Every 5xx should be traceable.** Log with a request id, so the "Internal server error" a user reports can be matched to the real stack trace (Day 16).

## 7. 🔗 Connects to
- [04 — Shared state](04-requests-shared-state-event-loop.md): unhandled async errors and the single process
- 06 — Interceptors: shape successes (filters shape failures); `catchError` in RxJS
- 07 — Pipes: throw `BadRequestException` for invalid input automatically
- 15 — Guards: `UnauthorizedException` / `ForbiddenException`

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice

1. Build `src/utils/http-exception.filter.ts` with the shape from 3.5 and register it **globally with DI** (`APP_FILTER`).
2. Hit `/user/999`. Check status + body.
3. Add a route that does `throw new Error('secret db password is hunter2')`. What does the client get? Why didn't your filter handle it?
4. Create `AllExceptionsFilter` with `@Catch()` that:
   - uses the real status for `HttpException`s,
   - returns a generic 500 message for everything else,
   - logs the **real** error server-side with `Logger` from `@nestjs/common` (injected or `new Logger(AllExceptionsFilter.name)`).

<details><summary>Hints</summary>

- `APP_FILTER` is imported from `@nestjs/core`; it goes in `AppModule`'s `providers`.
- Step 3: `@Catch(HttpException)` only matches `HttpException` and subclasses. A plain `Error` falls through to the built-in handler.
- Step 4: `exception instanceof HttpException ? exception.getStatus() : 500`.
- `exception.message` for a `NotFoundException` is your string; `exception.getResponse()` gives the full object (validation errors live there, Day 4).

</details>

## 10. ❓ Quiz

**Q1.** Frontend code: `if (!res.ok) return showToast(data.message)`. Backend returns `{ message: 'User not found' }` with no exception thrown. What happens, and what else is affected?

- A) Toast shows. Everything is fine.
- B) No toast: status is 200, so the UI treats the error object as a user. Uptime/error-rate dashboards also count it as success.
- C) Browser converts it to 404
- D) `fetch` throws

<details><summary>Answer</summary>

**B.** Status codes are how **machines** (browsers, `fetch`, proxies, caches, monitoring, retries) understand the result.
The body is only for humans and your own code.

</details>

**Q2.** A service throws `new Error('connect ECONNREFUSED 10.0.3.12:5432')`. No custom filters. What does the client receive?

- A) 500 with that exact message
- B) 500 with `"Internal server error"` and the real error logged on the server
- C) 404
- D) The request hangs forever

<details><summary>Answer</summary>

**B.** Unknown errors are hidden from the client. The message reveals your DB's private IP and port, which is useful to an attacker.
Rule: **the client gets a safe message, the logs get the truth.**

</details>

**Q3.**
```ts
@Post()
create(@Body() dto: CreateUserDto) {
  this.mailService.sendWelcome(dto.email);   // returns a Promise, NOT awaited
  return { ok: true };
}
```
`sendWelcome` rejects 1 second later (mail server down). What happens?

- A) The exception filter catches it and the client gets 500
- B) The client already got 201. The rejection is unhandled: no filter sees it, and by default modern Node crashes the process, killing other users' in-flight requests too
- C) It's always silently ignored
- D) Nest retries the email

<details><summary>Answer</summary>

**B.** Filters only see errors thrown **inside** the pipeline Nest is awaiting. The request was already done.
Fixes: `await` it (if the response should depend on it), or `.catch(err => logger.error(...))`, or better, push the email to a **background queue** with retries (Day 15).

</details>

**Q4.** `UserService.findById` throws `NotFoundException`. A new nightly cron job calls `findById` for 10,000 users to send reports; some users were deleted. What's the senior concern?

- A) None, the cron job gets a 404 response
- B) The service is coupled to HTTP: the cron job catches an "HTTP 404" that has no meaning there. Consider domain errors mapped to HTTP by a filter, or a `findByIdOrNull` for non-HTTP callers.
- C) Cron jobs can't catch exceptions
- D) Nest converts it to a log line automatically

<details><summary>Answer</summary>

**B.** Nothing crashes if handled, but the abstraction leaks: business code now "speaks HTTP".
It's a **judgment call**: fine for small apps, painful in large ones with many entry points (HTTP, queues, cron, GraphQL, WebSockets).

</details>

**Q5.** In `main.ts`: `app.useGlobalFilters(new AllExceptionsFilter())`. Later you add `constructor(private readonly logger: AppLogger)` to the filter. What happens?

- A) Nest injects `AppLogger` automatically
- B) TypeScript error: missing constructor argument. You called `new` yourself, so the DI container isn't involved. Register it via `APP_FILTER` in a module instead.
- C) Works, logger is `undefined`
- D) Works only if the filter is `@Injectable()`

<details><summary>Answer</summary>

**B.** Rule from notes 02/03: **whoever calls `new` provides the arguments.** In `main.ts` that's you.
With `{ provide: APP_FILTER, useClass: AllExceptionsFilter }`, Nest calls `new` and injects dependencies.

</details>
