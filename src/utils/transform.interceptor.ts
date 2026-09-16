import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse();
    const statusCode = response.statusCode ?? 200;

    return next.handle().pipe(
      map((data: T) => {
        return {
          statusCode: statusCode,
          data: data,
          success: true,
        };
      }),
    );
  }
}
