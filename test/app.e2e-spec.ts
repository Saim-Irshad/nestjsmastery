// ============================================================================
// app.e2e-spec.ts: START THE REAL APP, SEND A REAL REQUEST
// ============================================================================
// A unit test calls one class directly with fakes around it. This one boots
// the whole application and sends an HTTP request through every layer:
// guard → interceptor → pipe → controller → service → back out again.
//
// Notes: notes/19-testing.md (Part B)
// ============================================================================

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // This builds the app from the MODULE GRAPH. It does not run src/main.ts.
    //
    // ⚠️ That used to make this whole file a lie. The global ValidationPipe and
    // TransformInterceptor were registered in main.ts, so the app built here
    // had neither, and the test below passed while asserting something no real
    // user ever sees. Measured on 2026-09-29:
    //   app built here : "Hello World!"
    //   app from main.ts: {"statusCode":200,"data":"Hello World!","success":true}
    //
    // Fixed by moving both bindings into AppModule as APP_PIPE and
    // APP_INTERCEPTOR, so the module graph carries them and this test now
    // exercises the same pipeline production does.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET) returns the wrapped envelope a real client gets', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ statusCode: 200, data: 'Hello World!', success: true });
  });

  afterEach(async () => {
    await app.close();
  });
});
