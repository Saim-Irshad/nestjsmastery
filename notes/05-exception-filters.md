# 05 — Exception Filters

> 📍 **Where on the Big Map:** the red ✖ path. If a guard, interceptor, pipe, controller or service **throws**, the filters decide what error response the client gets.
> 🎥 **Video:** 00:30:23 – 00:33:21
> 📘 **Course:** video 14 (Send User-Friendly Error Messages) · video 53 (Catch Exceptions with Filters, folded in at §3.6) · 🌿 **Branch:** `main`
> 📚 **Docs:** [Exception filters](https://docs.nestjs.com/exception-filters) · [Catch everything](https://docs.nestjs.com/exception-filters#catch-everything) · [Binding filters](https://docs.nestjs.com/exception-filters#binding-filters) · [Built-in HTTP exceptions](https://docs.nestjs.com/exception-filters#built-in-http-exceptions)

## 1. The problem

This is what `getUserById` in `src/user/user.service.ts` looked like at first:

```ts
getUserById(id: string) {
  const user = this.users.find(...);
  if (user) return user;
  return { message: 'User not found' };   // ❌
}
```

It looks polite. The client asked for a user that does not exist and gets told so. Here is what actually goes over the wire for `GET /user/999`:

```
HTTP/1.1 200 OK                          ← "success!"
{ "message": "User not found" }
```

The status line says everything went fine. As a frontend developer you have been on the receiving end of this:

```js
const res = await fetch('/user/999');
if (!res.ok) showError();     // never runs, status is 200
setUser(await res.json());    // user = { message: 'User not found' } 💥 UI renders garbage
```

And it is worse than one broken screen. Monitoring counts the request as a success, so the error-rate graph stays flat while users are staring at "undefined". Caches and proxies are allowed to store a 200, so the "not found" answer can get cached. And because each endpoint invents its own error shape (`{ message }` here, `{ error: true }` there, `null` somewhere else), the frontend needs a different `if` for every route.

What we want: throw an error anywhere in the call chain, and get a **correct status code** and **one consistent error shape** on the way out, without touching every controller.

## 2. Mental model

In React, a component deep in the tree throws. You do not wrap every component in `try/catch`. The error bubbles up until the nearest Error Boundary catches it and renders a fallback. Nest has the same arrangement for your API:

```
React:  a component deep in the tree throws → bubbles up → nearest ErrorBoundary renders fallback UI
Nest:   a service deep in the call chain throws → bubbles up → nearest exception filter sends an error response
```

Throwing means "stop everything and go back up the call stack until someone catches this". Nest puts one big catch around the whole request pipeline, so a `throw` anywhere between the guard and the service ends in the same place, and that place decides what the client sees.

## 3. Baby steps

### Step 1 — Naive: return an error-shaped object

That is the section 1 code. The client gets 200 and a body that looks nothing like a user. Every consumer (browser, `fetch`, monitoring, cache) is told a lie in the one place they all read: the status line.

### Step 2 — Set the status by hand in the controller

Take over the response object and write the status yourself:

```ts
@Get('/:id')
getUserbyId(@Param('id') id: string, @Res() res: Response) {
  const user = this.userService.getUserById(id);     // returns user OR { message }
  if ('message' in user) return res.status(404).json(user);
  return res.status(200).json(user);
}
```

`GET /user/999` now returns a real 404. Three things are wrong with it:

- The controller now speaks Express directly. Once you call `res.json()` yourself, Nest's standard handling is skipped, and the `TransformInterceptor` in this repo can no longer wrap the response (note 03 warns about `@Res()` for the same reason; note 06 shows what the interceptor does).
- The service still returns a "maybe a user, maybe a message" object, so every caller has to check which one it got. A cron job calling `getUserById` would have to do the same `'message' in user` dance.
- You have to repeat this in every handler. The day someone forgets, that route is back to step 1.

### Step 3 — Throw a plain `Error` in the service

Move the decision to where the knowledge is. The service knows the user is missing, so the service should stop:

```ts
getUserById(id: number) {
  const user = this.users.find((u) => u.id === id);
  if (!user) throw new Error('User not found');
  return user;
}
```

No `if` in the controller, no `@Res()`. And the client gets:

```json
{ "statusCode": 500, "message": "Internal server error" }
```

Better than a fake 200, but now "user not found" and "database on fire" look identical from the outside. The real message is hidden (on purpose, as section 4.3 explains), so the client cannot tell the difference, and the frontend cannot show "no such user" because it never receives those words.

### Step 4 — Throw something that carries its status

Nest ships error classes that know their own HTTP status. This is what `src/user/user.service.ts:126` does today:

```ts
getUserById(id: number) {
  const user = this.users.find((user) => user.id === id);
  if (user) {
    return user;
  } else {
    throw new NotFoundException(`User with ID "${id}" not found`);
  }
}
```

There is no `try/catch` in `src/user/user.controller.ts:99–102`; the controller calls the service and returns whatever comes back. The client now gets:

```
HTTP/1.1 404 Not Found
{ "message": "User with ID \"999\" not found", "error": "Not Found", "statusCode": 404 }
```

Correct status, a useful message, one line of code, and nothing per route. What is still wrong:

- The body shape is Nest's default, not ours. This repo wraps successes as `{ statusCode, data, success: true }` (note 06), so the frontend now sees two shapes: an envelope on success and a bare `{ message, error, statusCode }` on failure.
- A plain `Error` (a bug, a DB outage) still becomes the generic 500, which is right for the client, but nobody in our code decided how to log it or how to attach a request id to it.
- The message is human text. A frontend that wants to react to "user not found" specifically has to string-match it, and the string will change.

### Step 5 — What a senior does

Keep throwing from the service, and write **one** piece of code that turns any thrown error into the response shape the whole API uses. It gets the error and a handle on the request/response, and it decides what to send:

```ts
@Catch(HttpException)                                   // which errors this one handles; @Catch() = everything
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();                    // host also works for WebSockets, microservices
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const status = exception.getStatus();

    res.status(status).json({
      success: false,
      statusCode: status,
      message: exception.message,            // ⚠️ not enough on its own, see §3.6
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

⚠️ That `exception.message` line is the version most examples show, and it loses information. For a validation error thrown by the `ValidationPipe`, `.message` is the string `"Bad Request Exception"` and the actual list of field errors lives in `exception.getResponse()` (measured in §3.6). Read `getResponse()` first and fall back to `.message`.

Three ways to attach it, and the difference matters:

```ts
@UseFilters(HttpExceptionFilter)                           // on one method or a whole controller
app.useGlobalFilters(new HttpExceptionFilter());           // main.ts: global, but YOU call `new` → no DI
{ provide: APP_FILTER, useClass: HttpExceptionFilter }     // in a module's providers: global + DI works
```

Then, on top of that, the senior version adds:

- a second, catch-all handler (`@Catch()` with no argument) that keeps unknown errors as a generic 500 for the client but **logs the real stack trace** on the server, with a request id;
- a stable machine-readable `code` field (`"USER_NOT_FOUND"`) next to the human message, so the frontend switches on the code and the message is free to change or be translated;
- in larger codebases, errors thrown by services that do not mention HTTP at all (`UserNotFoundError`), with the filter doing the translation to 404. Section 8 weighs that trade-off.

That one piece of code, the class with `@Catch` and a `catch()` method that turns a thrown error into a response, is what Nest calls an **exception filter**. The error classes that carry their own status (`NotFoundException` and friends) all extend one base class, **`HttpException`**.

### The built-in error classes you will reach for

Each one is an `Error` with a status number attached. The choice is about **who can fix it**:

| Exception | Status | Use when |
|---|---|---|
| `BadRequestException` | 400 | Input is invalid (pipes throw this automatically, note 07) |
| `UnauthorizedException` | 401 | **Not logged in** / token missing or invalid ("who are you?") |
| `ForbiddenException` | 403 | Logged in but **not allowed** ("I know you, but no") |
| `NotFoundException` | 404 | Resource doesn't exist |
| `ConflictException` | 409 | Clashes with current state (email already taken) |
| `UnprocessableEntityException` | 422 | Well-formed but semantically invalid |
| `InternalServerErrorException` | 500 | Our fault |

4xx means **the client's** fault: they can change the request and try again. 5xx means **the server's** fault: retrying might help, and someone on our side should get paged. Picking the wrong side has real effects, which section 7 lists.

### 3.6 What the official course adds (video 53)

The course builds a filter too, and it is worth walking through it with a requirement attached, because on its own it looks like a syntax demo.

**The requirement.** Support forwards a complaint: *"I got an error on the coffee page this morning, around half nine."* You have this morning's log, several hundred thousand lines of it, and no way to tie that sentence to one of them. Two pieces of information would close the gap, and they need to be in the response the user can screenshot and in the log line side by side: **when** it happened and **which URL** produced it. Nest's default error body has neither:

```json
{ "message": "Coffee #-1 not found", "error": "Not Found", "statusCode": 404 }
```

So the requirement is: *every error response must carry a timestamp and the request path, and no controller or service may have to do anything about it.* That last clause is what makes it a filter rather than forty edits.

**Where the file goes.** The course generates it with `nest g filter common/filters/http-exception`, into a `common/` folder: the place for code that belongs to no single feature (the same instinct as the `src/utils/` folder in this repo, and the same idea as "cross-cutting" in note 16).

**The filter, line by line.**

```ts
@Catch(HttpException)                                        // ① which errors are mine
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();                         // ② "treat this as HTTP"
    const response = ctx.getResponse<Response>();            //    the Express res
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();                    // ③ keep the ORIGINAL status

    let exceptionResponse = exception.getResponse();         // ④ the error's own body
    exceptionResponse =
      typeof exceptionResponse === 'string'                  //    …which is sometimes a string
        ? { message: exceptionResponse }
        : exceptionResponse;

    response.status(status).json({
      ...(exceptionResponse as object),                      // ⑤ keep everything it already said
      timestamp: new Date().toISOString(),                   //    add what the requirement asked for
      path: request.url,
    });
  }
}
```

Five things in there are worth pausing on.

**① `@Catch(HttpException)` is a filter on a filter.** It takes one class or a comma-separated list (`@Catch(HttpException, QueryFailedError)`), and Nest does the `instanceof` check for you before it ever calls your `catch` (section 4.1 shows that lookup in ten lines of JS). `HttpException` is the base class of every `NotFoundException`, `BadRequestException` and friend from the table above, so naming the base catches all of them.

**② `ArgumentsHost` is "the arguments your handler was called with, whatever transport this is".** Over HTTP those arguments are Express's `(req, res, next)`; over WebSockets they are a socket and a payload; in a microservice they are a message. The filter never receives `req` and `res` directly, because the same class has to work in all three cases. `host.switchToHttp()` is you saying "I know this one is HTTP", and only then do you get `getResponse()` and `getRequest()`. It is the smaller sibling of `ExecutionContext` from note 06 §4.7, which adds `getHandler()` and `getClass()` on top.

**③ `getStatus()`, not a hardcoded number.** One filter serves every `HttpException`, so it must ask each one what status it carries: 404 from `NotFoundException`, 403 from a `ForbiddenException`, 400 from a pipe. Write `response.status(500)` in there and every user mistake in the application becomes a page for on-call.

**④ `getResponse()` returns two different shapes, and the course's `typeof` check is not defensive padding.** Measured on a scratch app with this exact filter (2026-09-27):

| Thrown | `exception.getResponse()` | Type |
|---|---|---|
| `new NotFoundException('Coffee #-1 not found')` | `{"message":"Coffee #-1 not found","error":"Not Found","statusCode":404}` | object |
| `new HttpException('create is disabled', HttpStatus.FORBIDDEN)` | `"create is disabled"` | string |

The built-in exception classes build an object for you; the raw `HttpException` constructor hands back whatever you passed it. Spreading a string would give you `{"0":"c","1":"r","2":"e", ...}`, one key per character, which is why the `typeof` line exists.

**⑤ The spread keeps the original body and adds to it.** Real responses from the same run:

```
GET /coffees/-1
  HTTP 404 Not Found
  {"message":"Coffee #-1 not found","error":"Not Found","statusCode":404,
   "timestamp":"2026-09-27T08:24:34.101Z","path":"/coffees/-1"}

POST /coffees            (the handler throws a raw HttpException with a string)
  HTTP 403 Forbidden
  {"message":"create is disabled","timestamp":"2026-09-27T08:24:34.111Z","path":"/coffees"}
```

Look at the second one: **no `statusCode` and no `error` in the body.** The status line is still 403, so nothing is broken, but the video's claim that this makes errors "fairly uniform" only holds for exceptions that were built with an object body. If the contract you promised the frontend includes `statusCode` in the body, build the body yourself instead of spreading:

```ts
response.status(status).json({
  statusCode: status,                                   // always there, taken from the exception
  message: (exceptionResponse as any).message ?? exceptionResponse,
  timestamp: new Date().toISOString(),
  path: request.url,
});
```

#### ⚠️ `exception.message` is not always the message

This one changes the code in step 5 above. Same scratch app, a global `ValidationPipe` and the body `{"name":"al"}` (2026-09-27):

```
[filter] exception.message       = "Bad Request Exception"
[filter] exception.getResponse() = {"message":["name must be longer than or equal to 3 characters",
                                               "email must be an email"],
                                    "error":"Bad Request","statusCode":400}
```

A `BadRequestException` thrown by the `ValidationPipe` carries the useful part, the list of what was wrong with each field, **only in `getResponse()`**. Its `.message` is the generic class name. So a filter written with `message: exception.message` (step 5, and most blog posts) silently throws away every validation message in the application, and the frontend gets `"Bad Request Exception"` with nothing to show next to the form fields. Read `getResponse()` and fall back to `.message`, not the other way round. The response the course's version produced for that body, which is the one you want:

```
HTTP 400
{"message":["name must be longer than or equal to 3 characters","email must be an email"],
 "error":"Bad Request","statusCode":400,"timestamp":"2026-09-27T08:26:36.278Z","path":"/user"}
```

#### Why a catch-all `@Catch()` needs care

`@Catch()` with no arguments claims **every** error in the application, including the ones that are not `HttpException`s at all: a `TypeError` from a typo, a driver error from Postgres, a rejected promise from an HTTP call. Those objects have no `getStatus()` and no `getResponse()`. Here is the same filter body under `@Catch()`, hit with a route that does `throw new Error('connect ECONNREFUSED 10.0.3.12:5432')` (2026-09-27):

```
GET /coffees/boom/plain
  HTTP 500 Internal Server Error
  <!DOCTYPE html><html lang="en"><head>…<title>Error</title></head><body>
  <pre>TypeError: exception.getStatus is not a function<br>
     at CarelessAllFilter.catch (…/scratchpad/dist/filters-demo.js:44:35)<br>
     at ExceptionsHandler.invokeCustomFilters (…/node_modules/@nestjs/core/exceptions/exceptions-handler.js:23:26)<br>
     … 8 more frames of absolute paths …</pre></body></html>
```

Three things went wrong at once, and they are all worse than the original error:

1. The filter itself threw, so Nest had nothing to send and the request fell through to **Express's own default error handler**, which in a non-production environment renders an HTML page.
2. That page contains a **stack trace with absolute filesystem paths**, which is exactly the leak section 4.3 says the built-in filter exists to prevent. A JSON API answered with HTML, so any client parsing the body also breaks.
3. The real cause, the database being unreachable, appears nowhere. You are now debugging `getStatus is not a function`.

The safe shape for a catch-all, which is practice task 4 in this note, asks first:

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : { message: 'Internal server error' };

    if (!isHttp) this.logger.error(exception);          // the truth goes to the log, not the client

    ctx.getResponse<Response>().status(status).json({
      ...(typeof body === 'string' ? { message: body } : (body as object)),
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest<Request>().url,
    });
  }
}
```

And two rules that come out of the experiment: **never assume the type of `exception` inside a catch-all**, and **never let a filter throw**. A filter is the last thing standing between an error and the client; if it falls over, there is nobody behind it.

#### Binding it

The course binds with `app.useGlobalFilters(new HttpExceptionFilter())` in `main.ts`, which is fine for this filter because it has no dependencies. The moment it wants the injected `Logger` above, or a `Reflector`, or a service that ships errors to Sentry, that form stops working, and the fix is `{ provide: APP_FILTER, useClass: ... }` in a module's `providers`. Note 16 Part A step 4 has the full comparison and the reason (you called `new`, so you supply the arguments); quiz Q5 below is the same trap.

📚 [Exception filters](https://docs.nestjs.com/exception-filters) · [Catching everything](https://docs.nestjs.com/exception-filters#catch-everything) · [Binding filters](https://docs.nestjs.com/exception-filters#binding-filters)

## 4. How it works underneath

### 4.1 Nest wraps every route in a try/catch

If you wrote it by hand in Express, this is roughly the code Nest generates for each route:

```js
// what Nest does for every route (simplified)
expressApp.get('/user/:id', async (req, res) => {
  try {
    // guards → interceptors → pipes → handler → interceptors
    const result = await userController.getUserbyId(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    const filter = findMatchingFilter(err);   // method → controller → global → built-in
    filter.catch(err, host);                  // host gives access to req/res
  }
});
```

And `findMatchingFilter` is about ten lines. `@Catch(HttpException)` is a label stuck on the class (the same trick as `@Controller`, note 03), and the lookup reads that label and checks `instanceof`:

```js
// @Catch(HttpException) ≈ Reflect.defineMetadata('catch', [HttpException], HttpExceptionFilter)

function findMatchingFilter(err) {
  const candidates = [...methodFilters, ...controllerFilters, ...globalFilters];   // nearest first
  for (const filter of candidates) {
    const types = Reflect.getMetadata('catch', filter.constructor) ?? [];
    if (types.length === 0) return filter;                    // @Catch() with nothing = catches everything
    if (types.some((T) => err instanceof T)) return filter;   // first match wins
  }
  return builtInFilter;                                       // nobody claimed it
}
```

That is the whole mechanism. The nearest filter that claims the error's type handles it; if none does, Nest's own built-in one does.

### 4.2 The call-stack bubble, with files

```
 GET /user/999
   │
   ▼
 src/user/user.controller.ts:100   getUserbyId(999)                  ← no try/catch here
   │
   ▼
 src/user/user.service.ts:126      throw new NotFoundException('User with ID "999" not found')
   │
   ▲ unwinds: the service's `return` never runs, the controller's `return` never completes,
   │          and the TransformInterceptor's `map` never sees a value (note 06)
   │
 Nest's catch (inside @nestjs/core)
   │  findMatchingFilter: method → controller → global → built-in
   ▼
 built-in filter → res.status(404).json({ message, error: 'Not Found', statusCode: 404 })
   │
   ▼
 client
```

Nothing after the `throw` line runs. That is the point of throwing: the code that discovered the problem does not have to know who will deal with it.

### 4.3 What the built-in filter sends

For an `HttpException` (or any subclass):

```json
{ "message": "User with ID \"999\" not found", "error": "Not Found", "statusCode": 404 }
```

For **anything else** (`throw new Error('db exploded')`, a `TypeError` from a typo, a rejected promise from the database driver):

```json
{ "statusCode": 500, "message": "Internal server error" }
```

The real message is **hidden** on purpose. `connect ECONNREFUSED 10.0.3.12:5432` tells an attacker your database's private address and port. So the client gets a safe sentence, and the real error goes to the server log. Quiz Q2 is exactly this.

## 5. Functional vs class

If you have written Express, you have seen the functional version of a filter: error-handling middleware is a function with four parameters, and Express calls it whenever a handler throws or calls `next(err)`.

```js
// FUNCTIONAL (Express style)                       // CLASS (Nest style)
function httpErrorHandler(err, req, res, next) {    @Catch(HttpException)
  if (!(err instanceof HttpException)) {            export class HttpExceptionFilter implements ExceptionFilter {
    return next(err);      // not mine, pass on       catch(exception: HttpException, host: ArgumentsHost) {
  }                                                     const ctx = host.switchToHttp();
  const status = err.getStatus();                       const res = ctx.getResponse<Response>();
  res.status(status).json({                             const status = exception.getStatus();
    success: false,                                     res.status(status).json({
    statusCode: status,                                   success: false,
    message: err.message,                                 statusCode: status,
    path: req.url,                                        message: exception.message,
  });                                                     path: ctx.getRequest().url,
}                                                       });
                                                      }
app.use(httpErrorHandler);   // register             }
                                                    // register: @UseFilters / useGlobalFilters / APP_FILTER
```

Same job, same lines, different packaging. In the function, "which errors are mine" is the first `if`; in the class, it is the `@Catch(...)` label on the outside, and Nest does the `instanceof` for you.

What the class version buys:

- **The type check lives outside the code.** Nest can read `@Catch(HttpException)` before calling you, so it can order filters and skip the ones that don't apply. The function has to be called to find out it doesn't want the error.
- **Dependency injection.** Register the class with `APP_FILTER` and Nest builds it, so `constructor(private readonly logger: AppLogger)` works. A bare function has no constructor to inject into (quiz Q5 is about the case where you `new` it yourself and lose this).
- **One shape across transports.** `host.switchToHttp()` exists because the same filter class can serve HTTP, WebSockets and microservices; the function above is Express-only.
- **`implements ExceptionFilter`** is a compile-time promise that the class has a `catch(exception, host)` method with the right signature. It disappears from the compiled JS (note 02), so it costs nothing at runtime and catches typos early.

What it costs: a class, a decorator and an `implements` for what is, underneath, one function. And two registration styles that look the same and behave differently (`new` in `main.ts` versus `APP_FILTER`), which is a trap the quiz covers.

## 6. In my project

- `src/user/user.service.ts:112`, `:126`, `:170` — three `throw new NotFoundException(...)` sites (`getUserByName`, `getUserById`, `updateUser`). The old `return { message: 'User not found' }` is gone. The functional sketch at the bottom of that file (`:191–212`) still shows the old `?? { message: 'User not found' }` shape, which is a useful reminder of what step 1 looked like.
- `src/user/user.controller.ts:99–102` — `getUserbyId` has no `try/catch`. The throw travels through it untouched.
- `src/main.ts:54–69` — a global `ValidationPipe` and a global `TransformInterceptor` are registered. **No filter is registered anywhere yet**, so every error in this app still goes to Nest's built-in filter. Building the custom one is practice task 1.
- Try it and look at the **status line**, not only the body: `curl -i localhost:3000/user/999`.

Notice the pairing with note 06. Our `TransformInterceptor` wraps **successes** as `{ statusCode, data, success: true }` (recorded there on 2026-09-17, where `GET /user/999` came back as the bare 404 body above, **not wrapped**). A custom filter shapes **errors** as `{ success: false, statusCode, message }`. Together they give the frontend **one predictable response contract**. Validation errors from the pipe (note 07) take the same red path: the pipe throws `BadRequestException`, the filter shapes the 400.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Return error objects with status 200 | `res.ok` is true, so the frontend treats the error as data; monitoring and alerts see success; caches may store the error | Users see garbage UI; on-call never gets paged because the error-rate graph is flat |
| `try/catch` in every controller to re-throw or call `res.status()` | Noise in every handler, each one with a slightly different shape; one forgotten route goes back to 200-with-error | The frontend team, writing a different `if` per endpoint |
| `catch (e) { return null; }` (swallowing) | The error disappears. The caller gets `null` and fails somewhere far away, later | Whoever debugs it, hours later, with no stack trace pointing at the real cause |
| Send `err.stack`, SQL errors or internal hostnames to the client | Internal structure, table names and private IPs leak | The security team, after an attacker uses the map you gave them |
| Use 500 for user mistakes (bad input) | The client thinks it is your fault and retries something that can never succeed; alerts fire for a typo | On-call, woken at 3am by a user mistyping an email |
| Use 401 when you mean 403 | The frontend's "401 → go to login" logic sends an already-logged-in user to the login page, which sends them back, in a loop | The logged-in user who is not allowed to see one page and now cannot use the app at all |
| Log every 404 as an ERROR | The real problems are buried under thousands of "not found" lines | On-call, scrolling past noise while a real outage is in the same log. Log 5xx loudly, 4xx quietly |

## 8. 🧠 Senior engineer lens

- **Errors are part of your API contract.** Frontend and mobile teams code against them. Add a stable machine-readable `code` (`"USER_NOT_FOUND"`). Messages change and get translated; codes don't.
- **HTTP exceptions inside services are a trade-off.** `NotFoundException` in `UserService` ties business logic to HTTP. If a cron job or queue worker calls the same method, "404" means nothing there. Bigger codebases throw **domain errors** (`UserNotFoundError`) and one filter maps them to HTTP. Small apps often accept the coupling. Know that you're making a choice (quiz Q4).
- **Errors that escape the pipeline don't reach filters.** A promise you start but do not `await` (fire-and-forget) that later rejects becomes an **unhandled rejection**. No filter sees it, because the request it belonged to is already finished. By default modern Node **crashes the process** on an unhandled rejection, taking every other user's in-flight request down with it, on the one thread from note 04 (quiz Q3).
- **Every 5xx should be traceable.** Log with a request id, so the "Internal server error" a user reports can be matched to the real stack trace. That id is the kind of thing a middleware or interceptor attaches (notes 06 and 16).
- **Filters are also where you decide what "safe" means.** The built-in one hides everything unknown. A custom catch-all should keep that default and add logging, never the other way round.

## 9. 🔗 Connects to

- [04 — Shared state](04-requests-shared-state-event-loop.md): unhandled async errors and the single process
- [06 — Interceptors](06-interceptors.md): shape successes (filters shape failures); errors skip `map`; `catchError` in RxJS
- [07 — Pipes](07-pipes-validation.md): throw `BadRequestException` for invalid input automatically
- 15 — Guards: `UnauthorizedException` / `ForbiddenException`
- [03 — DI](03-modules-controllers-providers-di.md): `APP_FILTER` vs `new` in `main.ts`; why `@Res()` skips Nest's handling

## 10. ✍️ In my own words
> _(write here)_

## 11. 🛠️ Practice

1. Build `src/utils/http-exception.filter.ts` with the shape from step 5 and register it **globally with DI** (`APP_FILTER`).
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
- `exception.message` for a `NotFoundException` is your string; `exception.getResponse()` gives the full object (validation errors live there, note 07).

</details>

## 12. ❓ Quiz

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
Fixes: `await` it (if the response should depend on it), or `.catch(err => logger.error(...))`, or better, push the email to a **background queue** with retries (Day 18, system design).

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
