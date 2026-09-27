# 07 — Pipes & Validation

> 📍 **Where on the Big Map:** the last gate before your controller method. After guards and the interceptors' before-part, run **once per argument** (`@Body`, `@Param`, `@Query`).
> 🎥 **Video:** 00:38:04 – 00:43:08
> 📘 **Official course:** video16 Intro to DTOs · video17 Validate Input with DTOs · video18 Handling Malicious Request Data · video19 Auto-transform Payloads · video58 Custom Pipes (file numbers per `course-map.md`)

## 1. The problem

Here is the route that creates a user, in `src/user/user.controller.ts:121`:

```ts
@Post()
createUser(@Body() createUserDto: CreateUserDto) {
  return this.userService.createUser(createUserDto);
}
```

It reads as if it were safe. `createUserDto` is typed as `CreateUserDto`, so surely `name` is a string and `email` is an email. It isn't. TypeScript types are deleted when the code is compiled (note 02), so at runtime that parameter is whatever the client put in the request body: `{ "name": 123 }`, `{}`, `{ "isAdmin": true }`, a 50 MB string. Nobody checks. The service pushes it into the array as it came.

The first fix you'd reach for is to check by hand, at the top of every handler:

```ts
@Post()
createUser(@Body() body: any) {
  if (typeof body.name !== 'string' || body.name.length < 3) throw new BadRequestException('bad name');
  if (!/^\S+@\S+$/.test(body.email)) throw new BadRequestException('bad email');
  return this.userService.createUser({ name: body.name, email: body.email });
}

@Get('/:id')
getUserbyId(@Param('id') id: string) {
  const n = parseInt(id);
  if (isNaN(n)) throw new BadRequestException('bad id');
  return this.userService.getUserById(n);
}
```

That works for two routes. It stops working the moment there are twenty: the same `if`s get copied around, somebody forgets one on the update route, the checks bury the one line that does the real work, and the day you change "min 3 characters" to "min 2" you have to find every copy. The error messages also come out different on every route, so the frontend can't rely on a shape.

If you've used Zod, Yup or react-hook-form, this is the same job, on the server. One difference matters: **frontend validation is UX, backend validation is security.** Anyone can skip your form and `curl` the API directly. The server is the line where "outside" ends, and nothing that crosses it is trusted until it has been checked (that line is called a **trust boundary**).

## 2. Mental model

Think of an airport:

```
 Guard  (note 15) = passport control: WHO are you, may you enter?
 Pipe            = baggage check: WHAT did you bring? Is it allowed? Repack it into the standard box.
 Handler         = your flight: only boards with checked, clean luggage.
```

The baggage check has exactly two jobs, and so does a pipe:

1. **Validate.** Bad input means throw, and the client gets a 400. The handler never runs.
2. **Transform.** Turn the input into what the handler wants: `"5"` becomes `5`, a plain JSON object becomes a `CreateUserDto` instance.

Frontend comparison: a pipe is the `schema.parse(input)` line from Zod, except you don't call it. Nest calls it for you, on every argument of every handler, before your code runs.

## 3. Baby steps

### 3.1 Naive: checks inside the handler

The code from section 1. Here's what it did to us before any of this existed, measured on the app (2026-09-18): the service did `this.users.find((u) => u.id === parseInt(id))`, and `GET /user/1abc` returned **user 1**, because `parseInt("1abc")` is `1`. That's not a bug in the check; it's the check being in the wrong place (the service) and being the wrong check (`parseInt` reads digits until the first non-digit and ignores the rest).

### 3.2 Better: one checker function per input shape

Pull the checks out into a function and call it at the top of each handler:

```ts
function checkCreateUser(body: unknown): { name: string; email: string } {
  if (typeof body !== 'object' || body === null) throw new BadRequestException('body required');
  const { name, email } = body as any;
  if (typeof name !== 'string' || name.length < 3) throw new BadRequestException('Name must be at least 3 characters long');
  if (typeof email !== 'string' || !/^\S+@\S+$/.test(email)) throw new BadRequestException('Email must be a valid email address');
  return { name, email };
}

@Post()
createUser(@Body() body: unknown) {
  const dto = checkCreateUser(body);          // you must remember this line, in every handler
  return this.userService.createUser(dto);
}
```

Now the rules live in one place, and the function returns a clean object with only the fields you meant. What's still wrong: you have to remember to call it, on every route, and the one route you forget is the one that gets attacked. The rules and the TypeScript type also drift apart: you add `age` to the type and forget to add it to the checker, and TypeScript is happy because the checker's return type was written by hand too.

### 3.3 Better: let the framework call the checker for you

What you want is: "before you call my handler, run this function on each argument, and if it throws, send a 400." Nest has a slot for exactly that. You give it a class with one method, `transform(value, metadata)`, and whatever that method returns is what the handler receives:

```ts
@Injectable()
export class ParsePositiveIntPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new BadRequestException(`${metadata.data} must be a positive integer`);
    }
    return n;                       // what you return is what the handler receives
  }
}

@Get('/:id')
getUserbyId(@Param('id', ParsePositiveIntPipe) id: number) { ... }
```

`metadata` tells the function what it's looking at:

```ts
{ type: 'body' | 'param' | 'query' | 'custom',
  metatype: CreateUserDto,   // the TS type of the parameter (from design:paramtypes, the same trick DI uses, note 03)
  data: 'id' }               // the string passed to the decorator: @Param('id')
```

Now nobody has to remember to call anything. If the route declares the pipe, the check runs. That class with a `transform` method is what Nest calls a **pipe**.

What's still wrong: writing a pipe per DTO would bring back the wall of `if`s, only moved into a class.

### 3.4 Better: rules that live on the shape itself

Instead of a checker function that describes the rules in code, write the rules **on the class that describes the shape**, one per property, and let one generic pipe read them. This is `src/user/dto/create-user.dto.ts:53-62`:

```ts
export class CreateUserDto {
  @IsString({ message: 'Name must be a string' })
  @MinLength(3, { message: 'Name must be at least 3 characters long' })
  name: string;

  @IsEmail({}, { message: 'Email must be a valid email address' })
  email: string;
}
```

Each `@IsString()` is a function that runs once, when the file loads, and writes a rule into a list keyed by "this class, this property". The generic pipe is `ValidationPipe`: given a body and the class the parameter is typed as, it builds an instance, looks up that class's rule list, runs every rule, and throws with all the messages at once. A class that only exists to describe the shape of data coming in is called a **DTO** (data transfer object). It's a class and not an `interface` because interfaces are erased at compile time and a class is not; the pipe needs something it can find at runtime.

That's what we have with `app.useGlobalPipes(new ValidationPipe())`. But the default `ValidationPipe` has a hole. We sent this body to the app (2026-09-18):

```json
{ "name": "hacker", "email": "h@x.com", "isAdmin": true }
```

and got **201**, with `isAdmin: true` saved on the user. Validation only checks the fields it has rules for; it doesn't remove the others, and the service did `{ ...dto }`. A client writing fields it was never meant to write is called **mass assignment**, and it's how "I set my own `role` to admin" bugs happen.

The options fix it. All four rows were tested on the app with that same body (2026-09-18):

| `new ValidationPipe(...)` | Handler receives | `instanceof CreateUserDto` |
|---|---|---|
| `{}` (what we had) | `{ name, email, isAdmin: true }` ⚠️ | false |
| `{ whitelist: true }` | `{ name, email }`: unknown field **stripped** | false |
| `{ whitelist: true, forbidNonWhitelisted: true }` | nothing: **400** `"property isAdmin should not exist"` | — |
| `{ whitelist: true, transform: true }` | `{ name, email }` | **true** |

In words:

- **`whitelist`**: only fields that have at least one validation decorator survive. Everything else is dropped before the handler sees it.
- **`forbidNonWhitelisted`**: instead of silently dropping, reject the whole request. Clients learn about their typos fast, and you learn about attacks.
- **`transform`**: the handler gets a real class instance instead of a plain object, and typed primitives are converted (`@Param('id') id: number` gets `5`, not `"5"`). For numbers inside a query DTO you also need `@Type(() => Number)` on the field (`src/common/dto/pagination-query.dto.ts:32`) or `transformOptions: { enableImplicitConversion: true }`; course video 12 and video 29 do the pagination version of this.

### 3.5 Built-in pipes for single values

A whole DTO is overkill for one URL segment. For those, Nest ships ready-made pipes that you attach to one parameter:

```ts
@Get('/:id')
getUserbyId(@Param('id', ParseIntPipe) id: number) { ... }   // "abc" → 400, "5" → 5, "1abc" → 400
```

The set: `ParseIntPipe`, `ParseUUIDPipe`, `ParseBoolPipe`, `ParseEnumPipe`, `ParseArrayPipe`, and `DefaultValuePipe` for optional inputs, chained like `@Query('page', new DefaultValuePipe(1), ParseIntPipe)`. Pipes placed inside a parameter decorator run for that one argument only.

### 3.6 What a senior does: attach once, at the right level, and close the update hole

There are four places a pipe can be attached, from narrowest to widest:

```ts
@Param('id', ParseIntPipe)                       // one parameter
@UsePipes(new ValidationPipe())                  // one method or one controller
app.useGlobalPipes(new ValidationPipe({...}))    // main.ts: every route (what we do)
{ provide: APP_PIPE, useClass: ValidationPipe }  // global, but created by DI, so the pipe can have injected services
```

The senior version in this project is three moves, all made on 2026-09-18:

1. `src/main.ts:54-60`: one global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Every route is covered, and nobody can forget.
2. `src/user/dto/update-user.dto.ts:38`: `class UpdateUserDto extends PartialType(CreateUserDto) {}`. Before, it was `extends CreateUserDto`, which inherited the rules too, so `PUT /user/1 { "name": "saim2" }` came back **400 "Email must be a valid email address"** because "email is required" was inherited. `PartialType` is a function that builds a new class at runtime with the same rules plus `@IsOptional()` on every field: if you send it, it must be valid; you don't have to send it.
3. `src/user/user.service.ts:152-153`: copy explicit fields (`name: dto.name, email: dto.email`) instead of `...dto`. The pipe is the first wall; this is the second, for the day someone adds `role` to the DTO for an admin route and reuses it.

## 4. How it works underneath

### 4.1 The loop Nest runs before calling your handler

For every request that matched a route, Nest builds the argument list before calling the method. Roughly:

```js
const args = [];
for (const param of handlerParams) {                 // e.g. [@Param('id'), @Body()]
  let value = extract(req, param);                   // req.params.id / req.body
  for (const pipe of [...globalPipes, ...controllerPipes, ...methodPipes, ...param.pipes]) {
    value = await pipe.transform(value, param.metadata);   // may THROW → 400, handler never runs
  }
  args.push(value);
}
return controller[handlerName](...args);
```

Two things to notice. Pipes run **per argument**, so a route with `@Param('id')` and `@Body()` runs the global pipe twice, with a different `metadata` each time. And the order is global first, then controller-level, then method-level, then the ones written inside the parameter decorator, each one receiving what the previous one returned.

### 4.2 What `ValidationPipe.transform` does

```js
async transform(value, { metatype }) {
  if (!metatype || [String, Number, Boolean, Array, Object].includes(metatype)) return value; // nothing to check

  const instance = plainToInstance(metatype, value);    // class-transformer: {..} → CreateUserDto object
  const errors = await validate(instance, {             // class-validator: runs @IsString, @IsEmail...
    whitelist, forbidNonWhitelisted,
  });
  if (errors.length) throw new BadRequestException(allMessages(errors));

  return this.transform ? instance : value;             // default: hands back the ORIGINAL plain object
}
```

The two libraries, in plain words:

- **class-validator** provides the `@IsString()`, `@MinLength()`, `@IsEmail()` decorators. Each one is a function that, when the file loads, appends `{ property: 'name', check: isString }` to a list stored against the class. `validate(instance)` finds that list through `instance.constructor` and runs every check.
- **class-transformer** turns plain JSON into an instance of the class: roughly `Object.assign(new CreateUserDto(), body)`, with nested classes handled when you tell it how (`@Type(() => AddressDto)`). It's needed because the rule list is keyed by class, and a plain object from `JSON.parse` has no class.

That's why `@Column()` decorators from TypeORM don't count as validation rules: they write into a different list, owned by a different library (section 6.1).

### 4.3 The flow, with files

```
POST /user   body: { "name": "al" }
   │
   ▼
Express parses JSON  →  req.body = { name: "al" }
   │
   ▼   guards (note 15), interceptor before-part (note 06)
   │
Nest reads the parameter list of UserController.createUser     src/user/user.controller.ts:121
   → [ { type: 'body', metatype: CreateUserDto } ]
   │
   ▼
global ValidationPipe                                            src/main.ts:54
   plainToInstance(CreateUserDto, body)  →  CreateUserDto { name: "al" }
   validate(instance)  →  reads the rules from                   src/user/dto/create-user.dto.ts:53-62
   │
   ├─ errors ──► throw BadRequestException ──► exception filter (note 05) ──► 400
   │             ["Name must be at least 3 characters long", "Email must be a valid email address"]
   │             (the interceptor's `map` never runs, so this 400 is NOT wrapped in { data, success })
   ▼ no errors
userController.createUser(instance)  →  userService.createUser   src/user/user.service.ts:132
   │
   ▼
TransformInterceptor after-part (note 06)  →  201 { statusCode: 201, data: {...}, success: true }
```

## 5. Functional vs class

A pipe is a function `(value, metadata) => newValue` that may throw. Nest asks for it wrapped in a class:

```js
// functional: what a pipe IS
const parsePositiveInt = (value, meta) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(`${meta.data} must be a positive integer`);
  return n;
};
// and Nest would call:  value = parsePositiveInt(value, meta)
```

```ts
// class: what Nest asks for
@Injectable()
class ParsePositiveIntPipe implements PipeTransform {
  transform(value, meta) { /* same body */ }
}
// and Nest calls:  value = new ParsePositiveIntPipe().transform(value, meta)   (or DI creates it once)
```

What the class buys: Nest can create it through DI, so a pipe can ask for a service in its constructor (a pipe that needs `ConfigService` to know the max page size, say). `implements PipeTransform` also makes TypeScript check the method name and signature for you. What it costs: a class, a decorator and an import for what is one function. For a pipe with no dependencies, the function version would be enough, and Nest does accept an object with a `transform` method (`new ValidationPipe()` is that: an instance you build yourself).

The DTO is the same story. Functionally, the shape and its rules would be a schema value:

```js
// functional: Zod-style
const CreateUser = z.object({ name: z.string().min(3), email: z.string().email() });
const dto = CreateUser.parse(req.body);      // throws on bad input, returns a clean object
```

```ts
// class: what Nest + class-validator use
export class CreateUserDto {
  @IsString() @MinLength(3) name: string;
  @IsEmail() email: string;
}
// and ValidationPipe does:  validate(plainToInstance(CreateUserDto, req.body))
```

What the class buys here is the one thing a schema value can't do in Nest: it doubles as the **TypeScript type** of the parameter *and* survives to runtime, so `design:paramtypes` can hand it to the pipe as `metatype`. You write `@Body() dto: CreateUserDto` once and get both the type and the rules. A Zod schema would need a separate `z.infer<>` type and an explicit `@Body(new ZodPipe(CreateUser))` on every route. What it costs: two libraries, decorator syntax, and rules that are a little harder to compose than chained schema calls (`PartialType`, `PickType`, `OmitType` from `@nestjs/mapped-types` cover the common cases).

## 6. In my project

| Where | What |
|---|---|
| `src/main.ts:54-60` | the one global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` |
| `src/user/dto/create-user.dto.ts:53-62` | `@IsString`, `@MinLength(3)`, `@IsEmail`, with custom messages |
| `src/user/dto/update-user.dto.ts:38` | `extends PartialType(CreateUserDto)` |
| `src/user/user.controller.ts:100` and `:141` | `@Param('id', ParseIntPipe) id: number` on both `:id` routes |
| `src/user/user.controller.ts:139-145` | the whole `UpdateUserDto` goes to the service, not only `.name` |
| `src/user/user.service.ts:121` | `getUserById(id: number)`: no more `parseInt` in business logic |
| `src/user/user.service.ts:152-153` | explicit `name: dto.name, email: dto.email` instead of `...dto` |
| `src/user/user.service.ts:175-176` | update only the fields that were sent (`!== undefined`) |
| `src/coffee/dto/create-coffee.dto.ts:22-46` | the coffee DTO with its own rules (see 6.1 for the bug that made it) |
| `src/coffee/coffee.controller.ts:40` and `src/common/dto/pagination-query.dto.ts:30-38` | `@Query()` typed as a DTO, so the query string gets the same checker, with `@Type(() => Number)` |

**Tested against the running app before the fixes (2026-09-18):**

| Request | Result |
|---|---|
| `POST {name:"ali", email:"ali@x.com"}` | 201 `{"statusCode":201,"data":{...},"success":true}` |
| `POST {name:"al"}` | 400 `["Name must be at least 3 characters long","Email must be a valid email address"]` |
| `POST {name:123, email:"a@b.com"}` | 400 `["Name must be at least 3 characters long","Name must be a string"]` |
| `POST` no body | 400, all three messages |
| `POST {name, email, isAdmin:true}` | **201, and `isAdmin: true` was saved** ⚠️ mass assignment |
| `PUT /user/1 {name:"saim2"}` | **400 "Email must be a valid email address"** ⚠️ update inherits "email required" |

Notice that validation 400s are **not wrapped** by `TransformInterceptor`. The pipe threw, so the interceptor's `map` never ran (note 06).

**After the fixes (same day, commit "fix: validation hardening"), tested again:**

| Request | Before | After |
|---|---|---|
| `POST {name, email, isAdmin:true}` | 201, `isAdmin` saved | **400** `"property isAdmin should not exist"` |
| `PUT /user/1 {name:"saim2"}` | 400 email required | **200**, only name changed |
| `PUT /user/1 {email:"s@x.com"}` | — | **200**, only email changed |
| `PUT /user/1 {name:"a"}` | — | **400** still validated if sent |
| `GET /user/1abc` | 200, returned user 1 | **400** `"Validation failed (numeric string is expected)"` |

What changed (these were practice tasks 1–3): the pipe options in `main.ts`, `PartialType` in `update-user.dto.ts`, `ParseIntPipe` on `:id` routes with the whole update DTO passed to the service, explicit fields and `id: number` in the service, and a `User` interface. Unit tests in `user.service.spec.ts` lock this behavior in (practice tasks 4–6 are still open).

### 6.1 "But DTO and entity are the same, why duplicate?" (asked 2026-09-22)

The mistake that raised the question was `export class CreateCoffeeDto extends PartialType(Coffee) {}`, reusing the TypeORM entity as the request shape. Every `POST /coffee` came back **400 "property name should not exist"**. The reason is section 4.2: `Coffee`'s `@Column()` decorators write into TypeORM's list, and class-validator keeps a **separate** list of rules. That list was empty, so `whitelist` treated every field as unknown. Without `forbidNonWhitelisted` it would have been worse: 201 with an empty row, every field silently stripped.

The deeper answer: **DRY means one source of truth for a piece of knowledge, not for anything that looks alike.** The two classes hold different knowledge:

| | Entity (`Coffee`) | DTO (`CreateCoffeeDto`) |
|---|---|---|
| Changes when... | the **database** changes | the **API contract** changes |
| Decorators | TypeORM `@Column`, `@ManyToMany` | class-validator `@IsString` |
| Contains | `id`, `createdAt`, `passwordHash`, `ownerId`, relations | only what a client may send |

They look identical for about two lessons. In course video 26 (relations) they split for real. The course's version:

```ts
// entity: flavors are ROWS with ids
@ManyToMany(() => Flavor, (flavor) => flavor.coffees, { cascade: true })
flavors: Flavor[];
@Column({ default: 0 }) recommendations: number;    // internal counter

// DTO: the client sends plain strings, and must never set `recommendations`
@IsString({ each: true }) flavors: string[];
```

In this project that split is `src/coffee/entity/coffee.entity.ts:85-87` (`flavor?: Flavor[]`) against `src/coffee/dto/create-coffee.dto.ts:42-45` (`flavor?: string[]`).

What coupling them costs: a database rename becomes a breaking API change; every new column becomes client-settable (mass assignment, section 3.4); API versioning becomes impossible; internal columns leak into public docs. What separation costs: about six lines per feature that rarely change.

Legitimate ways to reduce the duplication:

1. Compose DTOs from DTOs with `@nestjs/mapped-types`: `PartialType`, `PickType`, `OmitType`, `IntersectionType`.
2. Put class-validator decorators **on the entity** and use it as a DTO. It works, because both metadata systems coexist on one class, and it's common in prototypes. You trade away everything in the table above, and it's hard to undo once clients depend on the shape.

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Trust the TS type (`dto: CreateUserDto`) with no pipe | Types are erased; anything gets in, including `name: 123` | Every user, when a bad record breaks a later read; you, at 3am, reading a stack trace from a place that "couldn't happen" |
| Validate only on the frontend | `curl`, Postman, old mobile app versions and scripts skip your form entirely | Everyone, once an attacker finds the endpoint |
| `ValidationPipe()` with no `whitelist` while spreading `...dto` into storage | **Mass assignment** (tested above): `isAdmin`, `role`, `id`, `balance` written by the client | The business: a self-promoted admin, a self-set balance |
| `class UpdateUserDto extends CreateUserDto` | Updates inherit **required** rules: `PUT {name}` fails with "email required" (tested) | Every client that wants to change one field; they start sending the whole object and overwrite fields by accident |
| `parseInt(id)` in the service | `parseInt("1abc") === 1`, so `/user/1abc` returns user 1 (tested). Two URLs map to one resource, which confuses caches, logs and URL-keyed security rules | Anyone relying on URLs being one-to-one with resources; also, converting input is the edge's job, not business logic |
| Check "email already taken" inside a pipe | Needs the DB (a business rule belongs in the service), and a check alone isn't safe: two signups at the same moment both pass | The second user, who gets a duplicate account; you, when the unique index is missing and there's no clean way to merge them (note 04, race) |
| Nested object without `@ValidateNested()` + `@Type(() => AddressDto)` | `address: { city: 123 }` passes; nested objects aren't validated by default | Whoever reads `city` as a string later |
| No size limits (`@MaxLength`, `@ArrayMaxSize`) | A 5 MB `name` or a 100k-item array gets through and costs CPU, DB and storage | Every other request in flight on that one Node process (note 04) |

## 8. 🧠 Senior engineer lens

- **Validate at the edge, once, then trust.** After the pipe, the rest of the code can rely on the shape. This is "parse, don't validate": turn untrusted input into a typed, known-good object at the boundary (`transform: true`), and never re-check it downstream.
- **Shape is not the same as business rules.** Pipes answer "is this well-formed?" (string, min length, email format). Services answer "is this allowed?" (email unique, max 3 teams). The database gives the final guarantee (constraints, unique indexes), because it's the only place that sees both concurrent requests.
- **Validation errors are a frontend contract.** A flat list of strings is hard to map onto form fields. Many teams use `exceptionFactory` to return `{ errors: { email: ['...'], name: ['...'] } }` so the form can highlight the right input.
- **Whitelisting is defense in depth, not the only defense.** Still copy explicit fields when writing to the DB (`{ name: dto.name, email: dto.email }`), because one day someone will add `role` to the DTO for an admin endpoint and reuse it.
- **DTOs double as documentation.** Swagger (course videos 61–65) reads the same classes to generate the API docs, so the contract you validate is the contract you publish.
- **Guards run before pipes on purpose.** Don't spend CPU validating, or reveal your validation rules to, people who aren't allowed in.

## 9. 🔗 Connects to

- [02 — Classes](02-js-classes-objects-this.md): runtime vs compile time, `extends`, decorators as functions
- [03 — DI](03-modules-controllers-providers-di.md): `design:paramtypes` powers both DI and `metatype`
- [04 — Shared state](04-requests-shared-state-event-loop.md): why uniqueness needs a DB constraint, not a check
- [05 — Exception Filters](05-exception-filters.md): pipes throw `BadRequestException`; filters shape the 400
- [06 — Interceptors](06-interceptors.md): validation errors skip `map`
- [09 — Database, Docker & TypeORM](09-database-docker-typeorm.md): the entity whose decorators are *not* validation rules (6.1)
- 15 — Guards: run **before** pipes. An unauthenticated request with a bad body gets 401, not 400.

## 10. ✍️ In my own words

> _(write here)_

## 11. 🛠️ Practice

1. **Close the hole:** turn on `whitelist`, `forbidNonWhitelisted` and `transform` in `main.ts`. Re-send the `isAdmin` request. Then also copy explicit fields in `createUser` instead of `...dto`.
2. **Fix updates:** make `PUT /user/1 {"name":"saim2"}` work while `{"name":"a"}` still fails.
3. **`ParseIntPipe`:** apply it to `:id` routes and remove `parseInt` from the service (the service now takes `id: number`). Compare `/user/1abc` before and after.
4. **Custom pipe** (course video 58): write `ParsePositiveIntPipe` (section 3.3) and use it on `:id`. What does `/user/-1` return?
5. **Frontend-friendly errors:** use `exceptionFactory` to return `{ statusCode: 400, errors: { name: [...], email: [...] } }`.
6. **Nested gotcha:** add `address: AddressDto` (`@IsString() city`) to `CreateUserDto`. Send `address: { city: 123 }` with and without `@ValidateNested()` + `@Type(() => AddressDto)`.

<details><summary>Hints</summary>

- 2: `pnpm add @nestjs/mapped-types` (**inside `nestjsmasterycourse/`**), then `export class UpdateUserDto extends PartialType(CreateUserDto) {}`.
- 3: `@Param('id', ParseIntPipe) id: number`. The TS type changes everywhere down the chain, and the compiler will show you each place.
- 4: The pipe's `transform` gets `metadata.data === 'id'`, which is handy for the error message.
- 5: `new ValidationPipe({ exceptionFactory: (errors) => new BadRequestException({ errors: Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})])) }) })`.
- 6: `@Type` comes from `class-transformer`. Without it, class-transformer doesn't know which class to turn the nested object into, so there are no rules to run.

</details>

## 12. ❓ Quiz

**Q1.** Global `new ValidationPipe()` with no options. `CreateUserDto` has `name` and `email` with decorators. Client sends `{ "name": "hacker", "email": "h@x.com", "role": "admin" }` and the service does `db.users.insert({ ...dto })`. What happens?

- A) 400, since `role` isn't in the DTO
- B) 201, and `role: "admin"` is stored, because fields without decorators are ignored by validation, not removed
- C) 201, `role` is stripped automatically
- D) TypeScript prevents it at compile time

<details><summary>Answer</summary>

**B.** Verified with `isAdmin` on our app. Validation only checks the fields it has rules for.
Fix: `whitelist: true` (strip) or `+ forbidNonWhitelisted: true` (reject), **and** copy explicit fields when writing to the DB.

</details>

**Q2.** Our service does `this.users.find((u) => u.id === parseInt(id))`. What does `GET /user/1abc` return?

- A) 400 Bad Request
- B) 404, since no user has id "1abc"
- C) User 1, because `parseInt("1abc")` is `1`
- D) 500

<details><summary>Answer</summary>

**C.** `parseInt` reads digits until the first non-digit and ignores the rest. Different URLs mapping to the same resource can break caching, logs and security rules keyed on the URL.
`ParseIntPipe` requires the **whole** string to be an integer, so it answers 400.

</details>

**Q3.** Signup requires a unique email. A teammate writes a custom pipe that queries the DB and throws 409 if the email exists. Two people sign up with the same email within 10ms. What happens?

- A) The pipe catches the second one
- B) Both requests may pass the check before either inserts, so you get two accounts, unless the DB has a unique index
- C) Nest runs pipes one request at a time, so it's safe
- D) The ValidationPipe detects duplicates

<details><summary>Answer</summary>

**B.** Check-then-insert race (note 04). Both `await` the DB lookup, both see "not taken", both insert.
The **unique index** is the real guarantee; the service catches the DB's duplicate-key error and turns it into 409. The pre-check is only for a nicer message.

</details>

**Q4.**
```ts
class AddressDto { @IsString() city: string; }
class CreateUserDto {
  @IsString() name: string;
  address: AddressDto;          // no decorators
}
```
With `whitelist: true`, the client sends `{ "name": "ali", "address": { "city": 123 } }`. Result?

- A) 400: city must be a string
- B) `address` is **stripped** entirely (it has no decorator, so whitelist removes it)
- C) Passes with `city: 123`
- D) 500

<details><summary>Answer</summary>

**B.** With `whitelist`, a property with **no** decorator isn't whitelisted, so it's removed. Without `whitelist` it would be **C**: kept and never checked.
Correct setup: `@ValidateNested() @Type(() => AddressDto) address: AddressDto;`. Then you get **A**.

</details>

**Q5.** A route has an auth guard **and** a body DTO. A request arrives with **no token** and an **invalid body**. What does the client get?

- A) 400 with validation messages
- B) 401 Unauthorized
- C) Both errors merged
- D) Depends on decorator order in the file

<details><summary>Answer</summary>

**B.** Guards run **before** pipes (Big Map). The request is rejected before anyone looks at the body.
That's intentional: don't spend CPU validating, or reveal your validation rules to, people who aren't allowed in.

</details>

**Q6.** The frontend validates with Zod, sharing the same schema. A teammate suggests removing backend validation "because it's duplicated". Strongest argument against?

- A) Backend validation is faster
- B) The API is reachable without the frontend (curl, scripts, old app versions, other clients). Frontend checks are UX; backend checks are the security boundary.
- C) Zod doesn't work in browsers
- D) Nest requires ValidationPipe

<details><summary>Answer</summary>

**B.** Sharing one schema between front and back (e.g. a shared package) is great to avoid **drift**, but the backend must still enforce it.

</details>
