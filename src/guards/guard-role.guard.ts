import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class GuardRoleGuard implements CanActivate {
  canActivate(
    _context: ExecutionContext, // `_` prefix = "intentionally unused" (generated stub, always allows)
  ): boolean | Promise<boolean> | Observable<boolean> {
    return true;
  }
}
