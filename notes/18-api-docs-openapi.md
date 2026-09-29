# 18 — API docs that can't drift: OpenAPI & Swagger

> 📍 **Where on the Big Map:** off it. This is the one thing in the course that does **not** sit on the request path. It runs **once at startup**, walks the route table Nest has already built, turns it into a document, and serves that document from an extra endpoint. No guard, no pipe, no interceptor is involved, and a real `POST /coffee` never touches any of it.
> 📘 **Course:** videos 61 (Introducing the Swagger Module) · 62 (Enabling CLI Plugin) · 63 (Decorating Model Properties) · 64 (Adding Example Responses) · 65 (Using Tags to Group Resources)
> 🌿 **Branch:** `config`
> 📚 **Docs:** [OpenAPI introduction](https://docs.nestjs.com/openapi/introduction) · [Types and parameters](https://docs.nestjs.com/openapi/types-and-parameters) · [Operations](https://docs.nestjs.com/openapi/operations) · [Decorators](https://docs.nestjs.com/openapi/decorators) · [CLI plugin](https://docs.nestjs.com/openapi/cli-plugin) · [Security](https://docs.nestjs.com/openapi/security) · [Mapped types](https://docs.nestjs.com/openapi/mapped-types)

All five videos are taught as "here is a decorator, put it on the class, refresh the page, look, more boxes". That leaves out the only question that matters, which is *what requirement makes a team spend a week on this*, and why the answer isn't "write a README". So this note starts on the other side of the fence — the side you were actually standing on for years — and works backwards.

---

## 1. The problem

You are back in your old job. You are three days into building a screen that creates a coffee, and you need to know four things:

- What URL do I call?
- What exactly goes in the body? Is `flavor` a string or an array of strings? Is it required?
- What comes back on success, and what field is the id called?
- What comes back when it fails, so I can show the right message?

You have four ways to find out, and you have used all of them.

**You read the backend source.** This works, if the repo is one you can clone, in a language you read, and you can find the DTO. It costs you twenty minutes per question, and it means every frontend developer on the team independently reverse-engineers the same file. It also means you are reading code that may not be what is deployed.

**You open the README.** Someone wrote a table of endpoints in March. It is now September. Two of the routes listed no longer exist, one body has an extra required field, and `PATCH /coffee/:id` is missing entirely because the person who added it did not know the table was there. You cannot tell which rows are stale by looking at them — they all look equally confident.

**You open the shared Postman collection.** Same disease with a nicer interface. Someone exported it once, it lives in a workspace, and it drifts the moment anyone changes a DTO. Worse, it drifts *silently and locally*: your copy and your colleague's copy disagree, and the saved request bodies contain whatever values were needed for a demo in April, including a hard-coded auth token that expired.

**You ask the backend developer in Slack.** This is the one everybody actually does, and it is the most expensive. It costs two people's attention, it takes between four minutes and a day depending on time zones, the answer exists only in a thread nobody will ever search, and the next person asks the same question next month.

Every one of those four has the same shape of failure: **the description of the API and the API itself are two separate things, and nothing forces them to agree.** The description is written by a human, at a moment in time, from memory. The code moves on. Nothing breaks when they diverge — no test fails, no build goes red — so the divergence is invisible until it costs somebody an afternoon.

Here is the naive version, written into `README.md`, so you can see the exact thing that rots:

```markdown
## Coffee API

| Method | Path          | Body                                      | Returns   |
|--------|---------------|-------------------------------------------|-----------|
| GET    | /coffee       | —                                         | Coffee[]  |
| POST   | /coffee       | `{ name: string, brand: string }`          | Coffee    |
| GET    | /coffee/:id   | —                                         | Coffee    |
```

Three things are already wrong with that table and you cannot see any of them from the table:

1. `POST /coffee` also accepts an optional `flavor: string[]`, added later — the table was never touched (`src/coffee/dto/create-coffee.dto.ts:45`).
2. `GET /coffee` takes `?limit=` and `?offset=` — the table says the body is `—` and says nothing about query strings at all (`src/common/dto/pagination-query.dto.ts`).
3. `PATCH /coffee/:id` and `DELETE /coffee/:id` exist and are not listed (`src/coffee/coffee.controller.ts:69`, `:77`).

The fix is not "write a better table". The fix is to stop writing the table by hand and **generate it from the thing that cannot be wrong: the running code.** Nest already knows every route — it built the route table at startup to be able to serve requests at all. If the document is produced by asking *that*, then a route that does not exist cannot appear in the document, and a route that exists cannot be missing from it. The format for writing such a document down is **OpenAPI**, and the page that renders it is **Swagger UI**.

That is the requirement this note is about, and it is worth stating in the form a ticket would:

> **The frontend team, the mobile team and two partner integrators must be able to see every route, its body shape, its query parameters, its success shape and its error shapes, without reading our source and without asking us — and the page must be wrong less often than a human-maintained one.**

Notice the last clause. "Wrong less often", not "never wrong". Generated documentation can still lie, and §3 step 6 and §7 are mostly about the specific ways it lies.

---

## 2. Mental model

Two pictures. The first is where the document comes from:

```
  STARTUP (once)                                       RUNTIME (every request)
  ──────────────                                       ───────────────────────
  @Controller('coffee')  ─┐
  @Get()                  │   Nest reads the sticky      GET /coffee
  @Post()                 ├─► labels and builds       ──► look up in the route table
  @Body() dto: Create...  │   the ROUTE TABLE            ──► guard → interceptor → pipe → handler
  @Query() q: Pagination..┘         │
                                    │
                                    │  SwaggerModule.createDocument(app, config)
                                    │  walks that same table and asks each entry:
                                    ▼  path? method? what class is @Body typed as?
                          ┌──────────────────────┐
                          │  one big JSON object │  ──► GET /api-json   (the document)
                          │  (the OpenAPI doc)   │  ──► GET /api        (Swagger UI renders it)
                          └──────────────────────┘  ──► GET /api-yaml
```

The document is a **by-product of the route table**, not a second description of it. That single fact is the whole value: the README can list a route that was deleted, and the generated document cannot, because the route table it was built from has no such entry.

The second picture is the comparison you already have. You have seen exactly this before, twice:

- **`.d.ts` files.** You do not hand-write the type declarations for your own library; `tsc --declaration` emits them from the source. Hand-written declarations drift from the implementation and nothing catches it; emitted ones cannot. OpenAPI is `.d.ts` for an HTTP API — a machine-readable description of the surface, generated from the thing it describes, consumable by people who do not have the source.
- **Storybook.** You do not write a separate document listing your components' props; the docs page is generated from the component and its prop types, so a renamed prop shows up in the docs on the same commit that renamed it.

And one more that matters later: **OpenAPI is a file format, not a Nest feature.** It is a JSON (or YAML) object with an agreed shape. Once you have that file, an entire ecosystem eats it: Swagger UI renders it as a page, `openapi-typescript` turns it into TypeScript types for your React app, Postman imports it as a collection that regenerates instead of drifting, contract-testing tools assert your server still matches it. The decorators in this note exist to produce that file. The file is the product.

---

## 3. Baby steps

### Step 1 — Naive: the hand-written table

The README block in §1. What breaks: the table and the code are two artefacts with nothing tying them together, so they diverge, and the divergence is silent. A stale row and a correct row look identical.

The failure story is not dramatic, which is why it survives for years: a frontend dev builds a form against the documented body, ships it, and the POST returns `400 ["property flavour should not exist"]` in QA. An hour goes into the wrong hypothesis (validation? casing? the proxy?) before someone opens the DTO and finds the field was renamed in June.

### Step 2 — Better: the shared Postman collection

Real improvement on one axis: the requests are executable, so you can click one and see an actual response rather than reading a promise. It answers "what does this return" honestly, once.

What is still wrong is worse than it looks, and it is worth naming precisely because this is the option most teams actually land on:

- The collection is a **copy**, made at a point in time, stored somewhere else. Nothing re-derives it when a DTO changes.
- It drifts **per person**. Your copy has your edits. Nobody's copy is authoritative, so "it works in mine" becomes a sentence people say.
- The saved bodies are **fixtures**, not schemas. `{"name": "Shipwreck Roast", "brand": "Buddy Brew"}` tells you two fields exist. It does not tell you `brand` is required, that `name` has a maximum length, or that `flavor` is allowed at all.
- Saved auth headers rot, and sometimes the rotted ones are real tokens that got committed.

### Step 3 — Generate the document from the app

Two calls in `main.ts`, and the video is right that this part is small:

```ts
// src/main.ts, after NestFactory.create(...) and before app.listen(...)
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('Coffee API')
  .setDescription('The coffee shop API')
  .setVersion('1.0')
  .build();                                            // ← a plain object describing the API's *cover page*

const document = SwaggerModule.createDocument(app, config);   // ← walks the route table, returns one big object
SwaggerModule.setup('api', app, document);                    // ← mounts /api, /api-json, /api-yaml
```

`DocumentBuilder` is a builder for the metadata *about* the API — title, version, description, servers, auth schemes. It knows nothing about your routes. `createDocument` is the line that does the work: it takes the finished `app` (so the route table exists) and returns the document. `setup` mounts it.

**What you get, measured.** Everything in this note was run on **2026-09-29** in a scratch app built from the same DTO and controller shapes as this repo, because `@nestjs/swagger` is not installed here (§6). Versions: `@nestjs/common` 12.1.1, `@nestjs/swagger` 12.0.2, `swagger-ui-express` 5.0.1.

```
/api       -> 200 text/html          (Swagger UI)
/api-json  -> 200 application/json   (the document)
/api-yaml  -> 200 text/yaml          (the same document, YAML)
```

The three paths come from the one string you passed to `setup('api', ...)`. The JSON one is the interesting one, because that is the file other tools consume.

Here is the real, unedited `/api-json` from a controller with `findAll`, `findById` and `create`, and DTOs carrying **only** their existing `class-validator` decorators — that is, this repo's DTOs as they stand today:

```json
{
  "openapi": "3.0.0",
  "paths": {
    "/coffee": {
      "get": {
        "operationId": "CoffeeController_findAll",
        "parameters": [],
        "responses": { "200": { "description": "" } },
        "tags": ["Coffee"]
      },
      "post": {
        "operationId": "CoffeeController_create",
        "parameters": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CreateCoffeeDto" }
            }
          }
        },
        "responses": { "201": { "description": "" } },
        "tags": ["Coffee"]
      }
    },
    "/coffee/{id}": {
      "get": {
        "operationId": "CoffeeController_findById",
        "parameters": [
          { "name": "id", "required": true, "in": "path", "schema": { "type": "number" } }
        ],
        "responses": { "200": { "description": "" } },
        "tags": ["Coffee"]
      }
    }
  },
  "components": {
    "schemas": {
      "CreateCoffeeDto": { "type": "object", "properties": {} }
    }
  }
}
```

Read what it got right, because it is more than nothing: every path, every method, the path parameter `id` with its type, and the fact that `POST /coffee` has a required JSON body of type `CreateCoffeeDto`. None of that was written by hand and none of it can be stale.

Now read the two lines that are the entire problem:

```json
"CreateCoffeeDto": { "type": "object", "properties": {} }
```

```json
"parameters": []          ← on GET /coffee, which takes ?limit= and ?offset=
```

**The body is an empty object and the query string has vanished.** The document says "POST /coffee requires a JSON body, and here is its schema: it has no fields". A frontend developer reading that page learns the route exists and learns nothing else. This is the state the course reaches at the end of video 61, and the video's own closing line — "it seems like a lot of information about each endpoint is missing(?)" — is the honest version.

Two smaller things worth noticing in that output, because they come up later:

- `"tags": ["Coffee"]` — nobody asked for a tag. Nest defaults it to the controller's class name with `Controller` stripped. That is the grouping video 65 is about, and it is already there, just with a machine's idea of a good name.
- `"responses": { "200": { "description": "" } }` — the status code is inferred (200 for GET, 201 for POST, matching Nest's own defaults), and the description is empty because nothing told it one.

### Step 4 — Why the body is empty

This is the step the course skips in one sentence ("TypeScript's metadata reflection system has several limitations"), and it is the step that makes everything after it make sense.

Look at the DTO:

```ts
export class CreateCoffeeDto {
  @IsString() name: string;
  @IsString() brand: string;
  @IsArray() @IsString({ each: true }) @IsOptional() flavor?: string[];
}
```

Now look at what actually exists at runtime, which is the compiled JavaScript. Types are a compile-time fiction; they are deleted. What survives is roughly:

```js
class CreateCoffeeDto {}                                   // ← no fields. none. the class body is empty.
__decorate([IsString(), __metadata("design:type", String)], CreateCoffeeDto.prototype, "name", void 0);
__decorate([IsString(), __metadata("design:type", String)], CreateCoffeeDto.prototype, "brand", void 0);
```

A field declaration with no initialiser (`name: string;`) emits **nothing**. There is no `name` property on the class, on the prototype, or anywhere else, until somebody assigns one. So when `createDocument` gets handed `CreateCoffeeDto` and asks "what are your fields?", there is nothing to ask. `Object.keys(new CreateCoffeeDto())` is `[]`.

The `__metadata("design:type", String)` line is the interesting exception, and it is why the *path* parameter `id` got a type while the body got nothing. That line is emitted by `emitDecoratorMetadata`, and TypeScript only emits it **for a member that has a decorator on it**. No decorator, no metadata. And even where it is emitted, it records one type per member — it cannot tell you the member exists in the first place, cannot tell you whether it is optional, and for `string[]` it records `Array` with no idea what is inside.

So the rule, in one line: **`createDocument` can see anything that left a sticky label on the class, and nothing else.** The route decorators left labels, so the routes are complete. The DTO fields left `class-validator` labels — but those are `class-validator`'s labels, on `class-validator`'s own shelf, and `@nestjs/swagger` does not read that shelf. (Not by default. Hold that thought until step 6; it turns out to be the most useful fact in this note.)

Which gives two possible fixes, and the course does both in order:

1. Put labels on the fields that `@nestjs/swagger` *does* read → `@ApiProperty` (step 5).
2. Have the compiler write those labels for you → the CLI plugin (step 6).

### Step 5 — `@ApiProperty` on the DTO fields

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCoffeeDto {
  @ApiProperty({ description: 'The name of the coffee.', example: 'Shipwreck Roast' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'The brand of the coffee.', example: 'Buddy Brew' })
  @IsString()
  brand: string;

  @ApiPropertyOptional({ description: 'Flavor notes.', example: ['vanilla', 'chocolate'] })
  @IsArray() @IsString({ each: true }) @IsOptional()
  flavor?: string[];
}
```

`@ApiPropertyOptional(...)` is `@ApiProperty({ required: false, ...})` under a shorter name.

Real `/api-json`, same app, same minute, with those three decorators added and nothing else changed:

```json
"CreateCoffeeDto": {
  "type": "object",
  "properties": {
    "name":   { "type": "string", "description": "The name of the coffee.", "example": "Shipwreck Roast" },
    "brand":  { "type": "string", "description": "The brand of the coffee.", "example": "Buddy Brew" },
    "flavor": { "description": "Flavor notes.", "example": ["vanilla", "chocolate"],
                "type": "array", "items": { "type": "string" } }
  },
  "required": ["name", "brand"]
}
```

Everything a client needs is now in there, including two things the empty version could not express: `flavor` is an **array of strings** (`items`), and `name` and `brand` are **required** while `flavor` is not.

The same decorator on `PaginationQueryDto` brings the query string back from the dead:

```json
"parameters": [
  { "name": "offset", "required": false, "in": "query",
    "description": "How many rows to skip.",   "schema": { "example": 0,  "type": "number" } },
  { "name": "limit",  "required": false, "in": "query",
    "description": "How many rows to return.", "schema": { "example": 20, "type": "number" } }
]
```

Nest worked out `in: "query"` on its own, because the argument was `@Query()`. The names, types, descriptions and examples came from the decorators.

**What is still wrong, and it is not a small thing.** Look at what you just wrote next to what was already there:

```ts
@ApiProperty({ description: 'The name of the coffee.', example: 'Shipwreck Roast' })   // for humans + tools
@IsString()                                                                            // for the server
name: string;                                                                          // for the compiler
```

Three declarations of the same fact, in three systems, on three consecutive lines, **with nothing keeping them in agreement**. Change the rule in one and the other two are quietly wrong. This is exactly the drift from §1, except now it has been moved from the README into the source file, three lines away from the truth, where it looks much more trustworthy than it is.

Here is that drift, built on purpose and measured. A DTO where `@ApiProperty` was written in January and the validation rule was tightened in June:

```ts
@ApiProperty({ description: 'Name, at least 2 characters.', example: 'Ka' })
@IsString() @MinLength(5) @MaxLength(30)
name: string;
```

The document the docs page serves:

```json
"CreateCoffeeDto": {
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Name, at least 2 characters.", "example": "Ka" }
  },
  "required": ["name"]
}
```

And the result of sending the example value that the docs page itself offers, through the docs page's own "Try it out" button:

```
POST /coffee  {"name":"Ka"}
HTTP/1.1 400 Bad Request
{"message":["name must be longer than or equal to 5 characters"],"error":"Bad Request","statusCode":400}
```

**The documentation's own example is rejected by the server.** No `minLength` appears anywhere in the document, so a client generating a form from the schema will allow two characters and get a 400 in production. The page looks authoritative, renders beautifully, and is lying. That is worse than the README, because nobody trusted the README.

### Step 6 — The CLI plugin: stop writing the labels by hand

The plugin exists because of step 5's last paragraph. If the TypeScript type and the `class-validator` rules are already sitting there in the file, something should read *them* rather than asking you to restate them.

That something has to run at **compile time**, because that is the last moment the types still exist. Nest ships a TypeScript transformer that hooks into `nest build` / `nest start`:

```json
// nest-cli.json
{
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "plugins": ["@nestjs/swagger"]          // ← the whole change
  }
}
```

⚠️ **It only takes effect through the Nest CLI.** `nest build` and `nest start --watch` load `nest-cli.json` and apply the transformer. A bare `tsc`, a `ts-node` run, a Jest transform or a bundler that does not know about this file will compile the same source **without** it, and your document quietly goes back to empty objects. That asymmetry is worth knowing before you spend an hour on "it works in dev and the deployed docs are blank".

**What it actually does, measured.** Same DTO as step 4 — `class-validator` decorators, no `@ApiProperty` anywhere — compiled with `nest build` and the plugin on. This is the real emitted `distp/coffee/dto/create-coffee.dto.js`:

```js
class CreateCoffeeDto {
    static _OPENAPI_METADATA_FACTORY() {
        return {
            name:   { required: true,  type: () => String },
            brand:  { required: true,  type: () => String },
            flavor: { required: false, type: () => [String] }
        };
    }
}
```

That static method is the whole trick. The plugin read the source file's type annotations before they were erased and wrote them back as a **runtime value**, on the class, where `createDocument` can find it. `required: false` for `flavor` came from the `?`. `type: () => [String]` came from `string[]`. None of it needed a decorator from you.

It does the same to controllers. This is the real emitted `coffee.controller.js`, with `openapi.ApiResponse(...)` lines that **do not exist in my source**:

```js
__decorate([
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200, type: [require("./coffee.controller").Coffee] }),   // ← written by the plugin
    __param(0, (0, common_1.Query)()),
], CoffeeController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: 201, type: require("./coffee.controller").Coffee }),     // ← written by the plugin
    __param(0, (0, common_1.Body)()),
], CoffeeController.prototype, "create", null);
```

It read `findAll(): Coffee[]` and `create(): Coffee` — the **return type annotations on your methods** — and turned them into the success-response decorators from video 64. So "the plugin can define a single successful response for each operation" means exactly this: it copies your return type.

**And now the part that fixes step 5's drift.** The plugin also reads `class-validator` decorators and turns them into schema constraints. Measured, with `@MinLength(5) @MaxLength(30)` on `name` and `@IsPositive()` on the pagination fields, and **no `@ApiProperty` in the file at all**:

```json
"name":   { "type": "string", "minLength": 5, "maxLength": 30 }
"offset": { "type": "number", "minimum": 1 }
"limit":  { "type": "number", "minimum": 1 }
```

`minLength: 5` came from `@MinLength(5)`. `minimum: 1` came from `@IsPositive()`. **One source of truth**: the rule the server enforces is the rule the document publishes, because they are the same line of code. The step-5 drift becomes structurally impossible for anything the shim understands.

(That last one is also a small bug report on this repo, delivered by the documentation: `minimum: 1` on `offset` is correct, and `offset=0` — the first page — is therefore rejected. `src/common/dto/pagination-query.dto.ts:41` already has a ⚠️ about it. Generated docs surface your validation mistakes, because they publish them.)

**What the plugin cannot infer.** Three limits, all measured, all things that will bite:

1. **It only processes files whose names end in `.dto.ts` or `.entity.ts`.** My `Coffee` response class lived in `coffee.controller.ts`, and the result was:

   ```json
   "Coffee": { "type": "object", "properties": {} }
   ```

   Empty, in the same document where `CreateCoffeeDto` was complete. The suffixes are configurable (`dtoFileNameSuffix`, `controllerFileNameSuffix`), and a class in a file with the wrong name is invisible to the plugin with no warning of any kind.

2. **`PartialType` from the wrong package produces nothing.** This is video 62's gotcha and it is worth measuring, because it survives the plugin. Both classes below extend the same fully-documented base:

   ```ts
   export class UpdateCoffeeDto        extends PartialType(CreateCoffeeDto) {}  // @nestjs/mapped-types
   export class UpdateCoffeeSwaggerDto extends PartialType(CreateCoffeeDto) {}  // @nestjs/swagger
   ```

   ```json
   "UpdateCoffeeDto":        { "type": "object", "properties": {} },
   "UpdateCoffeeSwaggerDto": { "type": "object", "properties": {
        "name":   { "type": "string", "description": "The name of the coffee.", "example": "Shipwreck Roast" },
        "brand":  { "type": "string", "description": "The brand of the coffee.", "example": "Buddy Brew" },
        "flavor": { "description": "Flavor notes.", "type": "array", "items": { "type": "string" } } } }
   ```

   Same base class, same decorators on it, one import line different. And note what is *absent* from the second one: there is no `"required"` array, which is precisely the "every property is now optional" that `PATCH` means. The `@nestjs/mapped-types` version is not broken — it does its job, which is copying `class-validator` rules — it does not copy OpenAPI metadata, because it does not know about it. With the plugin on, the emitted `_OPENAPI_METADATA_FACTORY()` for the mapped-types version returns literally `{}`.

3. **Prose is not in the type system.** The plugin can tell you `name` is a required string of 5–30 characters. It cannot tell you it must be unique per brand, that it appears on the receipt, or that changing it invalidates the cache. That is what `@ApiProperty({ description })` is still for — and the plugin is explicitly an *override* system, so a hand-written `@ApiProperty` on one field wins and everything else stays inferred. There is also a middle path: turn on `introspectComments` and your JSDoc becomes the description. Measured, with `/** The name of the coffee. */` above the field and no `@ApiProperty`:

   ```json
   "name": { "type": "string", "description": "The name of the coffee.", "minLength": 5, "maxLength": 30 }
   ```

   ```json
   // nest-cli.json
   "plugins": [{ "name": "@nestjs/swagger", "options": { "introspectComments": true } }]
   ```

   The comment a developer writes for the next developer becomes the sentence the frontend team reads. One place, two audiences.

📚 [CLI plugin](https://docs.nestjs.com/openapi/cli-plugin) lists every option, including `classValidatorShim` (on by default — that is the `minLength` behaviour above) and the file-suffix settings.

### Step 7 — Errors, grouping and auth: the three decorators that fill in what no compiler can know

The plugin gets you the happy path. Three things remain that no amount of type inference can reach, because they are not in the types.

**Error shapes (`@ApiResponse`, video 64).** Your handler's return type describes success. It says nothing about the 404 you throw, the 403 a guard produces, or the 400 the `ValidationPipe` produces — those never appear as a return value, so nothing can infer them:

```ts
@Get()
@ApiForbiddenResponse({ description: 'Your API key is not allowed to read the menu.' })
@ApiResponse({ status: 200, description: 'The menu.', type: [CoffeeResponse] })
findAll(@Query() q: PaginationQueryDto) { ... }
```

`@ApiForbiddenResponse` is `@ApiResponse({ status: 403 })` with a name; there is one of these for every common code (`@ApiNotFoundResponse`, `@ApiBadRequestResponse`, `@ApiUnauthorizedResponse`, `@ApiCreatedResponse`…). Measured result:

```json
"responses": {
  "200": { "description": "The menu.",
           "content": { "application/json": {
              "schema": { "type": "array", "items": { "$ref": "#/components/schemas/CoffeeResponse" } } } } },
  "403": { "description": "Your API key is not allowed to read the menu." }
}
```

This is the half of the original requirement that people forget. A frontend cannot be written against success shapes alone — the whole job is deciding what the screen does when it fails, and "what can this endpoint return when it goes wrong" is the question the Slack thread in §1 was really about.

**Grouping (`@ApiTags`, video 65).** Step 3's output already had `"tags": ["Coffee"]`, auto-derived from the class name. `@ApiTags('coffees')` on the controller replaces it with a name you chose, and every route in that controller lands under one heading in the UI. On an API with forty routes across eight controllers, this is the difference between a page you can navigate and a wall. It also carries into generated clients, where tags usually become the names of the generated service classes — so `@ApiTags('coffees')` is quietly naming a class in someone else's codebase.

**Auth (`@ApiBearerAuth`, plus `DocumentBuilder`).** Two halves, and both are needed:

```ts
new DocumentBuilder().setTitle('Coffee API').setVersion('1.0').addBearerAuth().build();   // declare the scheme
```

```ts
@ApiTags('coffees')
@ApiBearerAuth()                    // "routes in here need that scheme"
@Controller('coffee')
export class CoffeeController {}
```

Measured:

```json
"components": { "securitySchemes": { "bearer": { "scheme": "bearer", "bearerFormat": "JWT", "type": "http" } } }
```

```json
"/coffee": { "get": { ..., "security": [ { "bearer": [] } ] } }
```

The practical payoff is the **Authorize** button in Swagger UI: paste a token once and every "Try it out" carries it. Without it, every request from the docs page is an unauthenticated one and every response is a 401, which reads as "your docs are broken".

⚠️ These decorators declare **intent**, not behaviour. `@ApiBearerAuth()` does not protect anything — the guard from note 16 Part B does. Putting it on a route with no guard produces a document that promises authentication on an endpoint that is wide open, which is the most dangerous kind of wrong this tool can be.

### Step 8 — What a senior does

**Decide who the document is for, then decide who may see it.** There are three different audiences and they want three different things: your own frontend (wants types — generate them from the JSON, do not read the page), partners (want the page, and want it stable), and attackers (want the page, very much). `SwaggerModule.setup` mounts a public, unauthenticated endpoint that lists every route you have, including the internal ones, with field names, validation rules and example values. Shipping that to production by accident is the single most common mistake with this tool. At minimum:

```ts
if (process.env.NODE_ENV !== 'production') {
  SwaggerModule.setup('api', app, document);
}
```

Better, if partners need it: keep it mounted and put it behind the same guard as everything else, or serve it from a separate internal host. `SwaggerModule.setup` takes options for basic auth on the page, and note 16's `@Public()` pattern is the other side of the same decision — a globally-guarded app will 401 its own docs page unless you label it.

**Treat the JSON as a build artefact, not a web page.** The most valuable consumer of `/api-json` is not a human. Write it to a file at build time and:

- generate the frontend's types from it (`openapi-typescript`), so a renamed field becomes a **TypeScript error in the React app** on the same commit that renamed it — which is the only mechanism in this whole note that makes drift *impossible* rather than merely unlikely;
- commit the file and diff it in CI, so a pull request that changes the public API shows that change in the review as a schema diff, not as a DTO edit someone has to notice;
- check it into the partner's hands as a versioned file rather than a live URL, so their build does not depend on your uptime.

`SwaggerModule.createDocument(app, config)` returns a plain object, so this is `fs.writeFileSync('openapi.json', JSON.stringify(document, null, 2))` in a small script that boots the app and exits.

**Examples are copy-pasted, so make them safe and make them valid.** Whatever you put in `example:` will end up in somebody's test, somebody's demo and, eventually, somebody's production request. Two rules follow: never use a real customer's data, a real email or a real key, and never use a value the server would reject (step 5's `"Ka"`). If the plugin's `classValidatorShim` is on, a bad example is at least *visible* next to the constraints in the same schema object.

**Write the error responses, not just the success ones.** The plugin gives you 200/201 free. The 400 (validation), 401 (guard), 403 (guard), 404 (service) and 409 (unique constraint) are the ones the client's code branches on, and none of them can be inferred. A global `@ApiBadRequestResponse` bound once via `DocumentBuilder` or a helper decorator beats forty hand-written ones.

**The name for all of this:** the format is **OpenAPI** (the specification used to be called Swagger, which is why the package, the UI and half the decorators still carry that name), the object `createDocument` returns is the **OpenAPI document**, the `#/components/schemas/...` entries are **schemas**, and each method-plus-path pair is an **operation**. The general idea — a machine-readable contract generated from the implementation — is worth more than any of those four words, and you will meet it again as GraphQL introspection, gRPC `.proto` files and tRPC's inferred types.

---

## 4. How it works underneath

There is no magic here at all, and the whole thing is two loops.

**`createDocument` reads the labels Nest already wrote.** Every decorator in this note is `Reflect.defineMetadata` on a class or a method (note 16 §B4 measured this for `@SetMetadata`, and `@ApiProperty` uses the same shelf). So the generator is a walk over the route table, asking each entry what labels it carries:

```js
// roughly what SwaggerModule.createDocument(app, config) is doing
function createDocument(app, config) {
  const document = { openapi: '3.0.0', paths: {}, components: { schemas: {} }, ...config };

  for (const controller of app.getControllers()) {                 // the route table, already built
    const basePath = Reflect.getMetadata('path', controller);      // written by @Controller('coffee')
    const tag = Reflect.getMetadata('swagger/apiUseTags', controller) ?? stripController(controller.name);

    for (const method of methodsOf(controller.prototype)) {
      const path   = Reflect.getMetadata('path', method);          // written by @Get('/:id')
      const verb   = Reflect.getMetadata('method', method);        // written by @Get
      const params = Reflect.getMetadata('design:paramtypes', method);  // written by emitDecoratorMetadata
      const routeArgs = Reflect.getMetadata('__routeArguments__', method); // which arg is @Body/@Query/@Param

      const bodyType = params[indexOfBodyArg(routeArgs)];          // → the CreateCoffeeDto CLASS itself
      if (bodyType) {
        document.components.schemas[bodyType.name] = schemaFor(bodyType);   // ← the interesting call
        // ...and the operation gets a $ref to it
      }
      document.paths[join(basePath, path)] ??= {};
      document.paths[join(basePath, path)][verb] = { operationId: ..., parameters: ..., responses: ..., tags: [tag] };
    }
  }
  return document;
}

function schemaFor(cls) {
  const fields = Reflect.getMetadata('swagger/apiModelProperties', cls.prototype)   // ← @ApiProperty wrote these
             ?? cls._OPENAPI_METADATA_FACTORY?.()                                   // ← the CLI plugin wrote this
             ?? {};                                                                 // ← neither: EMPTY OBJECT
  return { type: 'object', properties: mapToJsonSchema(fields), required: requiredOnes(fields) };
}
```

That final `?? {}` is the whole of step 3's empty body. Nothing failed, nothing warned — the lookup came back with nothing and an empty schema is a perfectly valid schema.

**The plugin is a TypeScript transformer, not a runtime thing.** `nest build` runs `tsc` with an extra pass that rewrites the AST before emit. It sees the source while the types are still there and adds nodes:

```
  create-coffee.dto.ts                     nest build  (plugins: ["@nestjs/swagger"])
  ─────────────────────                    ──────────────────────────────────────────
  class CreateCoffeeDto {                  1. parse to an AST
    @IsString() @MinLength(5)              2. is this file named *.dto.ts ?          ← the suffix check
    name: string;                          3. for each property: read its TYPE node
    flavor?: string[];                        and its class-validator decorators
  }                                        4. synthesise  static _OPENAPI_METADATA_FACTORY()
                                           5. emit JS
                                                        │
                                                        ▼
  class CreateCoffeeDto {
    static _OPENAPI_METADATA_FACTORY() {
      return { name: { required: true, type: () => String, minLength: 5 },
               flavor: { required: false, type: () => [String] } };
    }
  }
```

Which is why the plugin is the *only* thing in this note that can see optionality and element types: it is standing at the one moment where `flavor?: string[]` still means something. By the time `createDocument` runs, that line has been deleted from the universe.

**And where the whole thing sits relative to a request:**

```
 BOOT                                                    │  EVERY REQUEST AFTER THAT
 ──────────────────────────────────────────────────────  │  ───────────────────────────
 import controllers  → decorators run                    │  GET /coffee
        │              (Reflect.defineMetadata × N)      │     └─► route table lookup
        ▼                                                │         └─► guard → interceptor → pipe → handler
 NestFactory.create(AppModule)  → route table built      │
        │                                                │  GET /api-json
        ▼                                                │     └─► res.json(document)   ← the object from boot
 createDocument(app, config)    → one JSON object ───────┼─────────┘   nothing is recomputed
        │
        ▼
 setup('api', app, document)    → mounts /api, /api-json, /api-yaml
        │
        ▼
 app.listen(3000)
```

The document is computed **once**, at startup, and served from memory. It costs nothing per request, and it cannot reflect anything that happens at runtime — which is the reason a route registered dynamically after boot will not appear in it.

---

## 5. Functional vs class

The class version is not the only way to get an OpenAPI document, and the comparison is genuinely close — closer than for guards or pipes — so it is worth laying out properly.

**Version 1 — hand-written YAML, next to a functional Express app.** This is what a Node team without decorators does, and it is still extremely common:

```yaml
# openapi.yaml, maintained by hand
paths:
  /coffee:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateCoffee' }
components:
  schemas:
    CreateCoffee:
      type: object
      required: [name, brand]
      properties:
        name:  { type: string, minLength: 5, maxLength: 30 }
        brand: { type: string }
```

```js
// and the server, which knows nothing about that file
app.post('/coffee', (req, res) => {
  if (typeof req.body.name !== 'string' || req.body.name.length < 5) return res.status(400).json({ ... });
  ...
});
```

This is §1's README with better syntax highlighting. Two descriptions of one thing, no link between them, guaranteed to diverge. (It is not *useless* — the file is machine-readable, so you can generate clients and even validate requests against it, which is the one path where it stops being a lie. But that is a whole framework's worth of work.)

**Version 2 — generate it from the schema you already validate with.** This is the functional answer that actually solves the problem, and it is the one you would reach for instinctively:

```ts
import { z } from 'zod';

const CreateCoffee = z.object({
  name:   z.string().min(5).max(30).describe('The name of the coffee.'),
  brand:  z.string().describe('The brand of the coffee.'),
  flavor: z.array(z.string()).optional(),
});

type CreateCoffee = z.infer<typeof CreateCoffee>;     // the TypeScript type, derived
const parsed = CreateCoffee.parse(req.body);          // the runtime validation, same object
const schema = toOpenApi(CreateCoffee);               // the documentation, same object
```

**One value, three outputs.** The type, the validator and the schema are the same object seen three ways, so they cannot disagree — not by convention, but because there is only one of them. (Libraries that do the `toOpenApi` step exist and are widely used; I have not run one in this repo, so treat the exact API as illustrative and the shape as the point.)

**Version 3 — decorators on a class, which is what Nest does:**

```ts
export class CreateCoffeeDto {
  /** The name of the coffee. */
  @IsString() @MinLength(5) @MaxLength(30)
  name: string;
}
```

Side by side:

| | Hand-written YAML | One schema object (zod-style) | Decorated class (+ CLI plugin) |
|---|---|---|---|
| Sources of truth | **two**, unlinked | **one** | **one and a half** — the class, plus any `@ApiProperty` you hand-write |
| Can the docs contradict the server? | constantly | no, structurally | not for anything the plugin infers; **yes** for anything you wrote by hand (measured in §3 step 5) |
| Where the TypeScript type comes from | written a third time | `z.infer`, derived | the class is the type |
| Optional fields | you say so | `.optional()`, one place | the `?`, read at compile time by the plugin |
| Cost when nothing is documented yet | you have nothing | you have nothing | **you already have most of it** — the DTOs exist, the routes exist |
| What it needs to work | discipline | a library and a parse call per route | a build step through the Nest CLI, and `.dto.ts` filenames |
| Failure mode | stale file | a type error | **silent empty object** |

**What the class version buys:** it is already there. You did not write `CreateCoffeeDto` for documentation — you wrote it in note 07 so the `ValidationPipe` would reject bad bodies, and you wrote `@Controller('coffee')` in note 03 so the route would exist. The document is assembled out of declarations that were already load-bearing. Turning it on is a build flag and two lines in `main.ts`, and the marginal cost of documenting a new endpoint afterwards is zero. No other option here has that property.

**What it costs:** the single source of truth is only single for the parts the compiler can see. The moment a fact lives in `@ApiProperty` and nowhere else — a description, an example, an error response — it is a second declaration sitting next to the first, free to contradict it, three lines away from the rule it contradicts, and looking far more official than a README ever did. It also costs a hidden dependency on *how* you compile: the same source through a different build produces a different document, with no error.

---

## 6. In my project

**`@nestjs/swagger` is not installed.** `grep -n "swagger" package.json` returns nothing, and `nest-cli.json` has no `plugins` array (`nest-cli.json:5-7` is `"compilerOptions": { "deleteOutDir": true }`). So there is no docs page, and the only description of this API is the note files. Everything measured above came from a scratch app in the session scratchpad, built from the same shapes.

Installing it would be `pnpm add @nestjs/swagger` — ⚠️ **inside `nestjsmasterycourse/`**, not the parent folder. `@nestjs/swagger` 12.0.2 declares a peer of `typescript@^5.5.0 || ^6.0.0`, and `package.json:56` has `"typescript": "^6.0.2"`, so that peer is satisfied. On Express (`@nestjs/platform-express`) the UI needs `swagger-ui-express` as well.

Here is what each existing file would produce, with nothing else changed:

- **`src/main.ts:38`** — `const app = await NestFactory.create(AppModule)`. The `createDocument` / `setup` pair goes after this and before `app.listen` at `src/main.ts:73` — the same gap the global pipe (`:54`) and global interceptor (`:69`) already occupy.
- **`src/coffee/dto/create-coffee.dto.ts:22`** — `CreateCoffeeDto` with `@IsString()` on `name` (`:25`), `brand` (`:28`) and `@IsArray() @IsString({each:true}) @IsOptional()` on `flavor` (`:45`). **Without the plugin this becomes `{"type":"object","properties":{}}`** — the exact output in §3 step 3, which was measured against a copy of this file. With the plugin: three properties, `required: ["name","brand"]`, `flavor` as `array of string`. The long ⚠️ comment at `:37` about flavor being words and not ids is the kind of prose `introspectComments` would publish, if it were moved onto the field as JSDoc.
- **`src/user/dto/create-user.dto.ts:45`** — `CreateUserDto`, with `@IsString() @MinLength(3)` on `name` (`:53-55`) and `@IsEmail()` on `email` (`:61-62`). With the plugin's `classValidatorShim` those become `minLength: 3` and `format: email` in the schema, which is the whole point of §3 step 6: the rule the server enforces is the rule the document publishes.
- **`src/common/dto/pagination-query.dto.ts:33,:38`** — `offset` and `limit`, both `@IsPositive() @IsOptional() @Type(() => Number)`. Measured on an identical copy: without annotation `GET /coffee` documents `"parameters": []` and the query string is invisible; with the plugin, both appear as optional query parameters of type number with `"minimum": 1`. That `minimum: 1` on `offset` is the bug already flagged at `:41` — `?offset=0` is rejected — and the docs page would publish it to everyone.
- **`src/coffee/dto/update-coffee.dto.ts:20`** — `import { PartialType } from '@nestjs/mapped-types'`. This is video 62's exact trap, measured in §3 step 6: `UpdateCoffeeDto` documents as `{"type":"object","properties":{}}` even with the plugin on and even with the base class fully documented, because `@nestjs/mapped-types` copies `class-validator` metadata and not OpenAPI metadata. Changing that one import to `@nestjs/swagger` fixes it, and the swagger version keeps doing the validation job too. Same line, same issue, in `src/user/dto/update-user.dto.ts:5`.
- **`src/coffee/coffee.controller.ts:25`** — `@Controller('coffee')`. With no `@ApiTags`, the group in the UI would be called `Coffee`, derived from the class name (measured). `findAll` (`:40`), `findById` (`:46`), `create` (`:58`), `updateById` (`:69`), `deleteById` (`:77`) — five operations, and **none of the five has a return type annotation**, so the plugin has nothing to infer a success schema from; every response would be an empty `200`/`201` with no body documented. Adding `: Promise<Coffee>` to the handlers is what turns that on.
- **`src/coffee/entity/coffee.entity.ts`** — matches the plugin's default `.entity.ts` suffix wherever it sits, so the entity is a candidate response schema. ⚠️ It is also the class that holds every column, which is exactly why note 07 §6.1 keeps it separate from the DTO: documenting the entity as the response publishes every column, including ones you would not want to promise or expose.
- **`nest-cli.json:5`** — the `compilerOptions` block where `"plugins": ["@nestjs/swagger"]` would go. ⚠️ It would only apply through `pnpm start:dev` / `nest build`. Anything compiling this repo with a bare `tsc` produces empty schemas.

**One more thing already true.** There is no guard in this repo (note 16 §B6), so a docs page mounted today would be publicly readable by anyone who can reach the port — including the `isAdmin`-shaped mistakes recorded at `src/main.ts:49`. The ordering in §3 step 8 is not academic here: the guard comes first.

---

## 7. ❌ How NOT to do it

| Mistake | What breaks | Who gets hurt |
|---|---|---|
| Keep the route table in the README and update it by hand | It goes stale within weeks and nothing indicates which rows are wrong. A confident, wrong document is worse than none — people stop double-checking | the frontend dev who builds a form against a renamed field and finds out in QA |
| Ship the docs page in production, unauthenticated | Your entire API surface, every internal route, every field name and every validation rule is a public reconnaissance document. `forbidNonWhitelisted` messages already leak field names one guess at a time (note 16 §B8); this hands over the whole list at once | the company, at the security review or after it |
| Add `SwaggerModule.setup` while a global `APP_GUARD` is bound, without `@Public()` | `/api` returns 401 and the docs "don't work". Someone fixes it by weakening the guard | everyone, via whatever the weakened guard lets through |
| Hand-write `@ApiProperty({ example, description })` next to `class-validator` rules and let them drift | **Measured:** docs say "at least 2 characters", example `"Ka"`, server answers `400 ["name must be longer than or equal to 5 characters"]`. The page's own Try-it-out button fails | every client that trusted the schema; and your credibility, which is why the next team writes their own docs |
| Put the CLI plugin in `nest-cli.json` and then build with bare `tsc` / `ts-node` / a bundler | Every schema silently becomes `{"type":"object","properties":{}}`. No error, no warning — it works in dev and the deployed docs are blank | whoever debugs "the docs are empty in staging only" |
| Name a DTO file something that isn't `*.dto.ts` (or a model `*.entity.ts`) | **Measured:** the plugin skips the file entirely. `"Coffee": {"type":"object","properties":{}}` appeared in the same document where `CreateCoffeeDto` was complete | the client who cannot find out what a successful response looks like |
| `PartialType` from `@nestjs/mapped-types` on a DTO you document | **Measured:** `UpdateCoffeeDto` documents as an empty object, with the plugin on and the base class fully documented. `PATCH` appears to accept nothing | anyone writing an edit screen, who has to go read your source — the exact thing this was meant to stop |
| Use real data in `example:` — a customer's email, a live key, a production id | Examples get copy-pasted into tests, demos, bug reports and production requests. A key in an example is a key in your logs, in Postman exports and in a public docs page | the customer whose email is now in a public schema; and you, rotating that key |
| Use an example the server would reject | Every client's first request 400s, and clients generating fixtures from the schema generate invalid ones at scale | the integrator who spends a day assuming they misread the docs |
| Document only success responses | The client has no idea what failure looks like, so it either shows a raw `[object Object]` or guesses. The Slack question from §1 comes back, unchanged | the end user staring at an unhandled error state |
| `@ApiBearerAuth()` on a route with no guard behind it | The document promises authentication on an open endpoint. Anyone auditing by reading the docs concludes it is protected | whoever's data is behind the route nobody re-checked |
| Document the entity instead of a response DTO | Every column is published, including internal flags, soft-delete timestamps and anything added later. New columns become public API without a decision | the team that now has to keep an accidental promise forever |
| Treat `/api-json` as the delivery mechanism and stop there | Drift is only *unlikely*, not impossible. Nothing fails when a field is renamed; the frontend still finds out at runtime | the frontend, at 2am, when a rename ships |

---

## 8. 🧠 Senior engineer lens

- **The value is the machine-readable file, not the pretty page.** Swagger UI is the demo; `/api-json` is the product. Generate the frontend's types from it and a renamed field becomes a compile error in the React app instead of a runtime surprise — that is the only mechanism discussed anywhere in this note that makes drift *impossible* rather than merely unlikely. Everything else reduces the probability of a lie; type generation removes the possibility.

- **An API you document is an API you have promised.** The moment a partner reads that page, every field on it is load-bearing, including the ones you meant as internal. This is the strongest argument for response DTOs over entities: the entity's shape is a database decision that will keep changing, and the document turns each change into a breaking change for someone. Decide deliberately what you publish, in a class whose entire job is being published.

- **Documentation drift is a class of bug, and the fix is always the same shape: derive, do not restate.** The plugin reading `@MinLength(5)` into `minLength: 5` is the same move as TypeScript emitting `.d.ts`, as `z.infer`, as an ORM generating migrations from entities. Every time you find yourself writing the same fact in two places, ask which one can be computed from the other. The places where that is impossible — a prose description, a business-meaning example, what a 409 means here — are the only places a human should be typing.

- **Docs are a deployment surface.** A public `/api` on a production host is reconnaissance-as-a-service: every route, every parameter name, every constraint, handed over in one request. Treat mounting it as an access-control decision, taken with the same seriousness as `APP_GUARD` (note 16 §B), not as a line you copy from a tutorial into `main.ts`.

- **Version the document, and diff it in CI.** Check `openapi.json` into the repo and regenerate it in the build. A pull request that changes the public API then shows that change as a schema diff a reviewer can read, rather than as a DTO edit somebody has to notice. This is also the cheapest possible breaking-change detector: a removed field or a newly-required one is a one-line diff, and you can fail the build on it.

- **OpenAPI is one point on a spectrum, and it is not always the right one.** The contract can be derived from the implementation (this note), or the implementation derived from the contract (spec-first: write the OpenAPI file, generate server stubs and client SDKs, and the server *cannot* diverge because it was generated). Code-first is faster and fits a team that owns both sides; spec-first is what you want when five teams consume the API and the contract must be agreed before anyone writes a handler. A third option skips the format entirely: GraphQL and tRPC make the schema the *only* artefact, with no second description to keep in sync — which is the same insight as §5's version 2, taken to its conclusion.

- **`createDocument` runs at boot, which has two consequences people trip over.** It costs startup time on a large app (measurable in the hundreds of milliseconds, since it walks every controller and builds every schema), and it captures a snapshot — anything registered after boot is invisible to it. On a serverless deployment where cold starts matter, generating the document at build time and serving a static file is strictly better than regenerating it in every cold container.

- **The best documentation is still the one nobody has to read.** A generated page is a fallback for the fact that the client and server are separate programs in separate repos. Where you control both, prefer the mechanism that turns a mismatch into a compile error. Where you do not, this is the best available, and its worth is exactly proportional to how automatically it is derived.

---

## 9. 🔗 Connects to

- [07 — Pipes & validation](07-pipes-validation.md) — the DTOs this note documents, why they are classes rather than interfaces (types are erased — the same fact that makes §3 step 4 true), and §6.1 on why the DTO is not the entity, which is also the "don't document the entity" argument in §7
- [16 — Building blocks & binding](16-building-blocks-and-binding.md) — §B4 measured `Reflect.defineMetadata` as the shelf every decorator writes to, which is the shelf `@ApiProperty` uses; §B is also where `@Public()` comes from, which is what a globally-guarded app needs before `/api` will load
- [17 — Middleware & custom decorators](17-middleware-and-custom-decorators.md) — `createParamDecorator` and the same "a decorator is a function that attaches a label" idea, from the argument-building end
- [03 — Modules, controllers, providers, DI](03-modules-controllers-providers-di.md) — the route table `createDocument` walks, and why `@Controller('coffee')` is a sticky label rather than behaviour
- [15 — Configuration](15-configuration.md) — where `NODE_ENV` comes from, which is what gates mounting the docs page in production
- [05 — Exception filters](05-exception-filters.md) — the error shapes that `@ApiResponse` documents; if you ever change the global error envelope, every documented error response has to change with it
- **Often confused with:** `class-validator` decorators, which look identical and sit on the same lines but are read by a different library for a different purpose (one enforces at runtime, the other describes at startup — and §3 step 6's `classValidatorShim` is the bridge between them)
- **Next:** course videos 66+ (testing), where the same DTO classes get a third consumer

---

## 10. ✍️ In my own words

> _(mine to write)_

---

## 11. 🛠️ Practice

1. **Feel the empty object before you fix it.** Install `@nestjs/swagger` and `swagger-ui-express`, add the `DocumentBuilder` / `createDocument` / `setup` block to `src/main.ts`, start the app, and open `/api-json` **before** touching any DTO. Find `CreateCoffeeDto` in `components.schemas` and `parameters` on `GET /coffee`. Write both down. Then predict, in one sentence each, why they look like that.

   <details><summary>Hints</summary>

   - ⚠️ `pnpm add` **inside `nestjsmasterycourse/`**. The parent folder has collected stray installs before.
   - `curl -s localhost:3000/api-json | python3 -m json.tool` is easier to read than the browser.
   - The answer to "why" is in §3 step 4 and it is one fact: a field declaration with no initialiser emits nothing. Check it yourself — `cat dist/coffee/dto/create-coffee.dto.js` and look for the word `name` outside the `__decorate` calls.
   </details>

2. **Do it the manual way once, then throw it away.** Put `@ApiProperty` on all three fields of `CreateCoffeeDto` and both fields of `PaginationQueryDto`. Diff `/api-json` against what you saved in task 1. Then delete every one of them and turn on the CLI plugin instead, and diff again.

   <details><summary>Hints</summary>

   - Save each version: `curl -s localhost:3000/api-json > /tmp/step1.json` etc., then `diff <(python3 -m json.tool /tmp/step1.json) <(python3 -m json.tool /tmp/step2.json)`.
   - The plugin needs `nest-cli.json` **and** a restart through `pnpm start:dev`. If nothing changes, that is the thing to check first.
   - The third diff is the interesting one: what did the plugin give you that your hand-written decorators did not? Look for `minLength`, `minimum` and `format`.
   </details>

3. **Reproduce the lie.** Put `@ApiProperty({ example: 'ab' })` on `src/user/dto/create-user.dto.ts:55`, which has `@MinLength(3)`. Open the docs page, press "Try it out", press Execute, and read the response. Then remove the `@ApiProperty` and let the plugin infer it. Record both in `notes/mistakes-and-aha.md`.

   <details><summary>Hints</summary>

   - The measured version of this is in §3 step 5 with different numbers; yours should fail the same way.
   - After the plugin infers it, look for `minLength` in the schema and ask whether an example could now contradict it without somebody noticing.
   </details>

4. **Fix the `PartialType` import and watch `PATCH` appear.** Change `src/coffee/dto/update-coffee.dto.ts:20` to import from `@nestjs/swagger`, restart, and compare the `UpdateCoffeeDto` schema before and after. Then check that validation still behaves — send a `PATCH` with a bad field and confirm you still get a 400.

   <details><summary>Hints</summary>

   - The "before" is measured in §3 step 6; confirm you get the same empty object.
   - After the change, look at whether a `required` array appears. Why is its absence the correct answer for a `PATCH`?
   - The validation check matters: you are replacing one library's `PartialType` with another's, so prove the `class-validator` half survived before you commit.
   </details>

5. **Document the failures, not the successes.** Add `@ApiNotFoundResponse` to `findById`, `updateById` and `deleteById` on `src/coffee/coffee.controller.ts`, with the message your service actually throws. Then add a return type annotation to each handler and see what the plugin does with it.

   <details><summary>Hints</summary>

   - Find the real message first — `grep -n "NotFoundException" src/coffee/coffee.service.ts` — and quote it, do not invent one.
   - The return type experiment is §3 step 6's second measurement: the plugin turns `: Promise<Coffee>` into an `ApiResponse` decorator in the compiled output. Check `dist/coffee/coffee.controller.js` for the word `openapi`.
   - Then ask the uncomfortable question the ⚠️ in §6 raises: do you want `Coffee` (the entity, every column) as your published response shape?
   </details>

6. **Make the docs page a build artefact.** Write `scripts/generate-openapi.ts` that boots the app with `NestFactory.create`, calls `createDocument`, writes `openapi.json` to disk and exits without listening. Commit the file. Then change one DTO field and regenerate, and look at the diff.

   <details><summary>Hints</summary>

   - You need the app object, not a running server: `const app = await NestFactory.create(AppModule, { logger: false })`, then `await app.close()` at the end. ⚠️ Without the close, the process hangs — the database connection keeps it alive.
   - `createDocument` returns a plain object, so the rest is `fs.writeFileSync`.
   - The payoff is the diff. A renamed field is now three lines in a review instead of something a reviewer has to spot in a DTO.
   </details>

7. **Go past the course: stop the drift at the other end.** Point `openapi-typescript` at the file from task 6 and generate TypeScript types. Then write a tiny script that uses one of the generated body types, rename a field in the DTO, regenerate, and watch the script fail to compile.

   <details><summary>Hints</summary>

   - This is the only step in the whole note where drift becomes a compile error rather than a runtime surprise. That is the point of the exercise.
   - Ask where this would live in a real setup: in the frontend repo, run in CI, against a committed `openapi.json` — or against the backend's live `/api-json`, and what breaks about the second option when the backend is down.
   </details>

8. **Lock the page down before you ever deploy it.** Mount `/api` only when `NODE_ENV !== 'production'`. Then, assuming the guard from note 16 §B existed, work out what you would need so the page still loads for a partner but not for the internet.

   <details><summary>Hints</summary>

   - `NODE_ENV` should come from `ConfigService` (note 15), not `process.env` read inline.
   - `@Public()` on the docs route is the easy, wrong answer. Ask who "a partner" is and whether an unauthenticated page listing every route is acceptable for them.
   - `SwaggerModule.setup` takes an options object; look for what it offers around protecting the page, and decide whether it is enough on its own.
   </details>

---

## 12. ❓ Quiz

**Q1.** You add `SwaggerModule.createDocument` + `setup` to `main.ts`, restart, and open `/api-json`. The routes are all there, but `POST /coffee` shows `"CreateCoffeeDto": {"type":"object","properties":{}}`. Your DTO definitely has three fields with `@IsString()` on them. What is actually wrong?

- A) `@nestjs/swagger` is not compatible with `class-validator`; you need to remove one
- B) The route decorators left runtime labels on the controller, so routes are complete — but `name: string;` with no initialiser emits **no property at all** in the compiled JS, and `class-validator`'s decorators write to their own metadata shelf that `@nestjs/swagger` does not read. There is nothing for `createDocument` to find, so it produces an empty schema
- C) You forgot `swagger-ui-express`
- D) `createDocument` was called before `NestFactory.create` finished

<details><summary>Answer</summary>

**B**, measured on 2026-09-29 against a copy of `src/coffee/dto/create-coffee.dto.ts` — that empty object is the real output, in a document where the paths, methods and the path parameter `id` were all complete.

The mechanism is worth being precise about, because it explains both of the next two fixes. TypeScript erases types, and a field declaration with no initialiser compiles to nothing — `Object.keys(new CreateCoffeeDto())` is `[]`. The `id` path parameter *did* get a type because `emitDecoratorMetadata` writes `design:paramtypes` for decorated members, but that only records a type for something it already knows exists; it cannot enumerate a class's fields, cannot see optionality, and records `string[]` as `Array`.

**C is a real requirement but the wrong diagnosis** — without `swagger-ui-express` the HTML page at `/api` would fail, while `/api-json` would still serve this same empty-property document.

</details>

**Q2.** Your team enables the CLI plugin in `nest-cli.json` and every schema fills in beautifully on your machine. CI deploys to staging and the docs page shows `{"type":"object","properties":{}}` for everything again. `nest-cli.json` is committed. What happened?

- A) The plugin needs `@nestjs/swagger` installed as a *production* dependency and CI installed it as a dev one
- B) Staging is running a build that did not go through the Nest CLI. The plugin is a TypeScript **transformer** applied by `nest build` / `nest start`, which read `nest-cli.json`; a bare `tsc`, a `ts-node` entry point or a bundler compiles the same source without it, producing no `_OPENAPI_METADATA_FACTORY` and therefore empty schemas — with no error and no warning
- C) `deleteOutDir` wiped the metadata
- D) The plugin only runs in watch mode

<details><summary>Answer</summary>

**B.** The plugin's entire output is a static method it synthesises into the emitted class. Measured, from a real `nest build`:

```js
class CreateCoffeeDto {
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String }, brand: { required: true, type: () => String },
                 flavor: { required: false, type: () => [String] } };
    }
}
```

No transformer, no method; no method, and `createDocument`'s lookup falls through to `{}`. The failure is silent in both directions, which is what makes it an afternoon rather than a minute: the config file is present and correct, and the thing that ignores it is the build command.

**A** is a genuine trap in a different shape (`@nestjs/swagger` must be a runtime dependency because `SwaggerModule` is imported by `main.ts`), but it would produce a crash on boot, not an empty schema.

</details>

**Q3.** A DTO has `@ApiProperty({ description: 'Name, at least 2 characters.', example: 'Ka' })` above `@IsString() @MinLength(5)`. A partner clicks "Try it out" on your docs page and executes it unchanged. What do they get, and what is the general lesson?

- A) 201, because the docs page sends what the schema declares and the server trusts it
- B) `400 {"message":["name must be longer than or equal to 5 characters"],...}` — the documentation's own example is rejected by the server. `@ApiProperty` is a *second* declaration of a fact whose first declaration is the `class-validator` rule on the next line, and nothing keeps the two in agreement. The general lesson is to derive rather than restate: with the plugin's `classValidatorShim`, `@MinLength(5)` becomes `minLength: 5` in the schema and the contradiction cannot exist
- C) 400, but only because `forbidNonWhitelisted` is on
- D) 500, because the schema and the validator disagree

<details><summary>Answer</summary>

**B**, built on purpose and measured on 2026-09-29. The document served:

```json
"name": { "type": "string", "description": "Name, at least 2 characters.", "example": "Ka" }
```

and the request it produced:

```
POST /coffee {"name":"Ka"}
HTTP/1.1 400 Bad Request
{"message":["name must be longer than or equal to 5 characters"],"error":"Bad Request","statusCode":400}
```

With the plugin and no `@ApiProperty` at all, the same DTO documented as `{"type":"string","minLength":5,"maxLength":30}` — inferred straight from the validation rules. That is the *reason* the plugin exists, not a convenience on top of it.

**C is wrong and worth naming**: `forbidNonWhitelisted` rejects unknown *fields*; this body has exactly the field the schema declares. The rejection is the length rule.

</details>

**Q4.** `PATCH /coffee/:id` shows an empty request body in the docs, while `POST /coffee` shows all three fields. The plugin is on and `CreateCoffeeDto` is fully documented. `UpdateCoffeeDto` is `extends PartialType(CreateCoffeeDto) {}` and nothing else. Why, and what does the fix change besides the docs?

- A) `PartialType` is not supported by OpenAPI; write the fields out again
- B) `PartialType` is imported from `@nestjs/mapped-types`, which copies `class-validator` metadata and knows nothing about OpenAPI. Importing it from `@nestjs/swagger` instead copies **both**, so validation keeps working and the schema fills in — and it arrives with **no `required` array**, which is the correct statement for a PATCH: every field optional
- C) The plugin skips classes that use `extends`
- D) `UpdateCoffeeDto` needs its own `@ApiProperty` decorators; inheritance never carries metadata

<details><summary>Answer</summary>

**B**, measured side by side in one document, both extending the same base class:

```json
"UpdateCoffeeDto":        { "type": "object", "properties": {} },
"UpdateCoffeeSwaggerDto": { "type": "object", "properties": { "name": {...}, "brand": {...}, "flavor": {...} } }
```

One import line apart. With the plugin on, the emitted `_OPENAPI_METADATA_FACTORY()` for the mapped-types version returns literally `{}`.

The "besides the docs" part is the interesting half. `@nestjs/mapped-types`' `PartialType` is not broken — it does exactly its job, which is producing a class with the same validation rules, all optional. The swagger version is a superset. So the change is safe, and `src/coffee/dto/update-coffee.dto.ts:20` and `src/user/dto/update-user.dto.ts:5` in this repo both currently have the mapped-types import.

**D is the tempting wrong answer**: metadata *does* carry through `PartialType`, which is the whole point of it — it carries through the swagger version and demonstrably does not through the other one.

</details>

**Q5.** A teammate ships `SwaggerModule.setup('api', app, document)` to production with no condition around it. The API has no guard yet. Rank the damage, and say which fix is right.

- A) No damage — documentation is public information by definition
- B) The page publishes every route including internal ones, every field name, every validation constraint and every example value, unauthenticated, to anyone who can reach the host. It is reconnaissance handed over in one request, and it also makes public promises about fields you considered internal. The fix is to treat mounting it as an access-control decision: gate it on environment, and where partners genuinely need it, put it behind the same auth as everything else
- C) Minor: rename the path from `/api` to something unguessable
- D) Minor: the real risk is the extra memory the document uses

<details><summary>Answer</summary>

**B.** Two separate harms, and people usually see only the first.

The security one: note 16 §B8 makes the point that `forbidNonWhitelisted` leaks field names one guess at a time, and calls that an accepted cost. A public docs page hands over the entire list at once — every path, every parameter, every constraint — which is the first hour of any assessment, done for them.

The one people miss: **a documented field is a promised field.** Anything on that page is now something an integrator has built against, which is why §8 argues for response DTOs over entities — publishing the entity turns every future column into a public API decision you did not make deliberately.

**C is security through obscurity** and fails to the first person who reads your `main.ts`, your bundle, or a stack trace. It also does nothing about the promise problem.

</details>

**Q6.** Your frontend consumes the API. You already generate `openapi.json` in CI. A backend PR renames `brand` to `roaster` in `CreateCoffeeDto`. Which setup catches this **before** anything reaches a user, and why is it categorically different from the rest of this note?

- A) Swagger UI — the reviewer sees the new field on the docs page
- B) The `ValidationPipe` — the old field name is rejected with a 400, so the frontend's tests fail
- C) Generating TypeScript types from `openapi.json` and compiling the frontend against them. The rename becomes a **compile error** in the frontend on the same commit. Everything else in this note lowers the probability that the docs are wrong; this is the only mechanism that turns a mismatch into a build failure instead of a runtime surprise
- D) The committed `openapi.json` diff in code review

<details><summary>Answer</summary>

**C.** Sort the options by what has to go right for them to work.

**A** needs a human to look at the right page and notice. **D** (§8's advice, and worth doing) needs a human to read a diff and connect it to a client they may not own — better, because the change is *visible* in the review rather than buried in a DTO, but still a person noticing something. **B** catches it, in the worst possible place: at runtime, in whatever environment the frontend's tests hit, after both sides have shipped.

**C** needs nobody to notice anything. The generated type no longer has `brand`, so the code referencing `brand` does not compile. That is the same category as `z.infer` in §5 and the same argument as the plugin reading `@MinLength` in §3 step 6: derive the second copy from the first, and disagreement stops being possible rather than merely unlikely. It is also why §8 calls `/api-json` the product and the rendered page the demo.

</details>
