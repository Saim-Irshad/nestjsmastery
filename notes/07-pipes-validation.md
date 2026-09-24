# 07 — Pipes & Validation

> 📍 **Where on the Big Map:** the last gate before your controller method. After guards and the interceptors' before-part, run **once per argument** (`@Body`, `@Param`, `@Query`).
> 🎥 **Video:** 00:38:04 – 00:43:08
> 📘 **Official course:** lesson19 Intro to DTOs · lesson20 Validate Input with DTOs · lesson21 Handling Malicious Request Data · lesson22 Auto-transform Payloads · lesson61 Custom Pipes (video file numbers)

## 1. The problem (why this exists)

```ts
@Post()
createUser(@Body() dto: CreateUserDto) { ... }
```

`dto: CreateUserDto` **checks nothing at runtime.** TypeScript types are erased (note 02). The body is whatever the client sent:
`{ "name": 123 }`, `{}`, `{ "isAdmin": true }`, a 50MB string...

Without pipes, every handler would start with a wall of `if`s:
```ts
if (typeof body.name !== 'string' || body.name.length < 3) throw new BadRequestException('...');
if (!/^\S+@\S+$/.test(body.email)) throw new BadRequestException('...');
const id = parseInt(params.id); if (isNaN(id)) throw ...
```

Frontend link: it's like **Zod / Yup / react-hook-form validation, but on the server.**
Key difference: **frontend validation is UX, backend validation is security.** Anyone can skip your form and `curl` the API directly.
The server is a **trust boundary**: nothing from outside is trusted until it has been checked.

## 2. Mental model

Airport:
```
 Guard  (note 15) = passport control: WHO are you, may you enter?
 Pipe            = baggage check: WHAT did you bring? Is it allowed? Repack it into the standard box.
 Handler         = your flight: only boards with checked, clean luggage.
```

A pipe has exactly two jobs:
1. **Validate**: bad input → throw → 400. The handler never runs.
2. **Transform**: convert input into what the handler wants (`"5"` → `5`, plain JSON → a `CreateUserDto` instance).

## 3. How it works behind the scenes

### 3.1 A pipe is a class with one method

```ts
@Injectable()
export class ParsePositiveIntPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(`${metadata.data} must be a positive integer`);
    return n;                       // what you return is what the handler receives
  }
}
```

`metadata` tells the pipe what it's looking at:
```ts
{ type: 'body' | 'param' | 'query' | 'custom',
  metatype: CreateUserDto,   // the TS type of the parameter (from design:paramtypes, the same trick DI uses)
  data: 'id' }               // the string passed to the decorator: @Param('id')
```

### 3.2 What Nest does before calling your handler (pseudo-code)

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

### 3.3 What `ValidationPipe` does (pseudo-code)

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

The two libraries:
- **class-validator**: the `@IsString()`, `@MinLength()`, `@IsEmail()` decorators. Each one registers a rule for that property when the file loads.
- **class-transformer**: turns plain JSON into an instance of your class, so the rules registered on that class can be found.

### 3.4 The options that matter (all tested, 2026-09-18)

Body sent: `{ "name": "hacker", "email": "h@x.com", "isAdmin": true }`

| `new ValidationPipe(...)` | Handler receives | `instanceof CreateUserDto` |
|---|---|---|
| `{}` (our current setup) | `{ name, email, isAdmin: true }` ⚠️ | false |
| `{ whitelist: true }` | `{ name, email }`: unknown field **stripped** | false |
| `{ whitelist: true, forbidNonWhitelisted: true }` | nothing: **400** `"property isAdmin should not exist"` | — |
| `{ whitelist: true, transform: true }` | `{ name, email }` | **true** |

- **`whitelist`**: only fields with at least one validation decorator survive.
- **`forbidNonWhitelisted`**: instead of silently stripping, reject the request (clients learn about typos fast).
- **`transform`**: the handler gets a real class instance, and typed primitives are converted (`@Param('id') id: number` gets `5`, not `"5"`).
  Query DTOs with numbers also need `transformOptions: { enableImplicitConversion: true }` or `@Type(() => Number)` on the field (course lesson12 / lesson32, pagination).

### 3.5 Built-in pipes for single values

```ts
@Get('/:id')
getUserbyId(@Param('id', ParseIntPipe) id: number) { ... }   // "abc" → 400, "5" → 5
```

`ParseIntPipe`, `ParseUUIDPipe`, `ParseBoolPipe`, `ParseEnumPipe`, `ParseArrayPipe`, `DefaultValuePipe` (e.g. `@Query('page', new DefaultValuePipe(1), ParseIntPipe)`).

### 3.6 Attaching pipes

```ts
@Param('id', ParseIntPipe)          // one parameter
@UsePipes(new ValidationPipe())     // one method or controller
app.useGlobalPipes(new ValidationPipe({...}))   // main.ts, what we do
{ provide: APP_PIPE, useClass: ValidationPipe }  // global + DI (if a custom pipe needs injected services)
```

## 4. In our project

- [src/main.ts](../src/main.ts): `app.useGlobalPipes(new ValidationPipe())`, no options yet
- [src/user/dto/create-user.dto.ts](../src/user/dto/create-user.dto.ts): `@IsString`, `@MinLength(3)`, `@IsEmail`
- [src/user/user.service.ts](../src/user/user.service.ts): `createUser(dto)` spreads `...dto`

**Tested against our running app (2026-09-18):**

| Request | Result |
|---|---|
| `POST {name:"ali", email:"ali@x.com"}` | 201 `{"statusCode":201,"data":{...},"success":true}` |
| `POST {name:"al"}` | 400 `["Name must be at least 3 characters long","Email must be a valid email address"]` |
| `POST {name:123, email:"a@b.com"}` | 400 `["Name must be at least 3 characters long","Name must be a string"]` |
| `POST` no body | 400, all three messages |
| `POST {name, email, isAdmin:true}` | **201, and `isAdmin: true` was saved** ⚠️ mass assignment |
| `PUT /user/1 {name:"saim2"}` | **400 "Email must be a valid email address"** ⚠️ update inherits "email required" |

Also notice: validation 400s are **not wrapped** by `TransformInterceptor`. The pipe threw, so `map` never ran (note 06).

**✅ After the fixes (same day, commit "fix: ..."): tested again:**

| Request | Before | After |
|---|---|---|
| `POST {name, email, isAdmin:true}` | 201, `isAdmin` saved | **400** `"property isAdmin should not exist"` |
| `PUT /user/1 {name:"saim2"}` | 400 email required | **200**, only name changed |
| `PUT /user/1 {email:"s@x.com"}` | — | **200**, only email changed |
| `PUT /user/1 {name:"a"}` | — | **400** still validated if sent |
| `GET /user/1abc` | 200, returned user 1 | **400** `"Validation failed (numeric string is expected)"` |

What changed (read the diff; these were practice tasks 1–3):
- `main.ts`: `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`
- `update-user.dto.ts`: `extends PartialType(CreateUserDto)`
- `user.controller.ts`: `@Param('id', ParseIntPipe) id: number`, and the whole update DTO goes to the service
- `user.service.ts`: explicit fields instead of `...dto`, `id: number`, update only the fields that were sent, `User` interface
- Unit tests in `user.service.spec.ts` lock this behavior in (practice tasks 4–6 are still yours)

## 5. ❌ How NOT to do it

| Don't | What goes wrong |
|---|---|
| Trust the TS type (`dto: CreateUserDto`) | Types are erased. Without a pipe, anything gets in. |
| Validate only on the frontend | `curl`, Postman, old mobile app versions and scripts skip your frontend. |
| `ValidationPipe()` with no `whitelist` + spreading `...dto` into storage | **Mass assignment** (tested above): `isAdmin`, `role`, `id`, `balance` get written by the client. |
| `class UpdateUserDto extends CreateUserDto` | Updates inherit **required** rules. Use `PartialType(CreateUserDto)` from `@nestjs/mapped-types`. |
| `parseInt(id)` in the service | `parseInt("1abc") === 1`, so `/user/1abc` returns user 1. `ParseIntPipe` rejects it. Also, converting input is the edge's job, not business logic. |
| Check "email already taken" inside a pipe | Needs the DB (business rule → service). And a check alone isn't safe: two signups at the same moment both pass. Only a **DB unique index** guarantees it (note 04 race). |
| Nested object without `@ValidateNested()` + `@Type(() => AddressDto)` | `address: { city: 123 }` passes. Nested objects aren't validated by default. |
| No size limits (`@MaxLength`, `@ArrayMaxSize`) | A 5MB `name` or a 100k-item array gets through and costs CPU/DB/storage. |

## 6. 🧠 Senior engineer lens

- **Validate at the edge, once, then trust.** After the pipe, the rest of the code can rely on the shape. This is "parse, don't validate": turn untrusted input into a typed, known-good object at the boundary (`transform: true`).
- **Shape ≠ business rules.** Pipes answer "is this well-formed?" (string, min length, email format). Services answer "is this allowed?" (email unique, max 3 teams). The DB gives the final guarantee (constraints).
- **Validation errors are a frontend contract.** A flat list of strings is hard to map onto form fields. Many teams use `exceptionFactory` to return `{ errors: { email: ['...'], name: ['...'] } }`.
- **Whitelisting is defense in depth, not the only defense.** Still copy explicit fields when writing to the DB (`{ name: dto.name, email: dto.email }`), because one day someone will add `role` to the DTO for an admin endpoint and reuse it.
- **DTOs double as documentation.** Swagger (course lesson61–63) reads the same classes to generate API docs.

### 6.1 "But DTO and entity are the same, why duplicate?" (asked 2026-09-22)

The mistake that triggered this: `export class CreateCoffeeDto extends PartialType(Coffee) {}` → every POST returned
**400 "property name should not exist"**. `Coffee`'s `@Column()` decorators are **TypeORM** metadata; `class-validator`
keeps a **separate** list of rules, and that list was empty, so `whitelist` treated every field as unknown.
(Without `forbidNonWhitelisted` it would be worse: 201 with an empty row, all fields silently stripped.)

The deeper answer: **DRY means one source of truth for a piece of knowledge, not for anything that looks alike.**

| | Entity (`Coffee`) | DTO (`CreateCoffeeDto`) |
|---|---|---|
| Changes when... | the **database** changes | the **API contract** changes |
| Decorators | TypeORM `@Column`, `@ManyToMany` | class-validator `@IsString` |
| Contains | `id`, `createdAt`, `passwordHash`, `ownerId`, relations | only what a client may send |

They look identical for about two lessons. In course lesson29 they split for real:

```ts
// entity: flavors are ROWS with ids
@ManyToMany(() => Flavor, (flavor) => flavor.coffees, { cascade: true })
flavors: Flavor[];
@Column({ default: 0 }) recommendations: number;    // internal counter

// DTO: the client sends plain strings, and must never set `recommendations`
@IsString({ each: true }) flavors: string[];
```

Costs of coupling them: a DB rename becomes a breaking API change; every new column becomes client-settable
(mass assignment, section 5); API versioning becomes impossible; internal columns leak into public docs.
Cost of separation: ~6 lines per feature that rarely change.

**Legitimate ways to reduce duplication:**
1. Compose DTOs from DTOs with `@nestjs/mapped-types`: `PartialType`, `PickType`, `OmitType`, `IntersectionType`.
2. Put class-validator decorators **on the entity** and use it as a DTO: technically fine (both metadata systems coexist),
   common in prototypes, but you trade away everything in the table above. Hard to undo once clients depend on the shape.

## 7. 🔗 Connects to
- [02 — Classes](02-js-classes-objects-this.md): runtime vs compile time, `extends`, decorators as functions
- [03 — DI](03-modules-controllers-providers-di.md): `design:paramtypes` powers both DI and `metatype`
- [04 — Shared state](04-requests-shared-state-event-loop.md): why uniqueness needs a DB constraint, not a check
- [05 — Exception Filters](05-exception-filters.md): pipes throw `BadRequestException` → filters shape the 400
- [06 — Interceptors](06-interceptors.md): validation errors skip `map`
- 15 — Guards: run **before** pipes. An unauthenticated request with a bad body gets 401, not 400.

## 8. ✍️ In my own words
> _(write here)_

## 9. 🛠️ Practice

1. **Close the hole:** turn on `whitelist`, `forbidNonWhitelisted` and `transform` in `main.ts`. Re-send the `isAdmin` request. Then also copy explicit fields in `createUser` instead of `...dto`.
2. **Fix updates:** make `PUT /user/1 {"name":"saim2"}` work while `{"name":"a"}` still fails.
3. **`ParseIntPipe`:** apply it to `:id` routes and remove `parseInt` from the service (the service now takes `id: number`). Compare `/user/1abc` before and after.
4. **Custom pipe** (course lesson61): write `ParsePositiveIntPipe` (section 3.1) and use it on `:id`. What does `/user/-1` return?
5. **Frontend-friendly errors:** use `exceptionFactory` to return `{ statusCode: 400, errors: { name: [...], email: [...] } }`.
6. **Nested gotcha:** add `address: AddressDto` (`@IsString() city`) to `CreateUserDto`. Send `address: { city: 123 }` with and without `@ValidateNested()` + `@Type(() => AddressDto)`.

<details><summary>Hints</summary>

- 2: `pnpm add @nestjs/mapped-types` (**inside `nestjsmasterycourse/`**), then `export class UpdateUserDto extends PartialType(CreateUserDto) {}`.
- 3: `@Param('id', ParseIntPipe) id: number`. The TS type changes everywhere down the chain, and the compiler will show you each place.
- 5: `new ValidationPipe({ exceptionFactory: (errors) => new BadRequestException({ errors: Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})])) }) })`.
- 6: `@Type` comes from `class-transformer`. Without it, class-transformer doesn't know which class to turn the nested object into, so there are no rules to run.

</details>

## 10. ❓ Quiz

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
`ParseIntPipe` requires the **whole** string to be an integer → 400.

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
