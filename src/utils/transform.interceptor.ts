// ============================================================================
// transform.interceptor.ts: WRAPS EVERY SUCCESSFUL RESPONSE
// ============================================================================
// { id: 1, name: 'saim' }  →  { statusCode: 200, data: { id: 1, ... }, success: true }
// Errors skip this (map only runs on values). See notes/06-interceptors.md.
// ============================================================================

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // BEFORE part: runs before the handler. We only grab the response object.
    const response = context.switchToHttp().getResponse<Response>();

    // `next.handle()` = recipe for "run pipes + handler"; `.pipe(map)` = then wrap.
    return next.handle().pipe(
      map((data: T) => ({
        // FIXED (2026-09-18): the status is read HERE, after the handler ran.
        // It used to be read above, before the handler, so if a handler ever
        // changed the status itself (e.g. res.status(202)), the envelope would
        // still report the old number.
        statusCode: response.statusCode,
        data,
        success: true,
      })),
    );
  }
}
