// src/app/api/organizations/[id]/route.ts
// Org-scoped read (feature 01): returns 404 for any organization that is not
// the caller's ACTIVE workspace — the 404 IDOR guard required by the spec.
// Super admins may read any organization (documented invariant exception).

import { apiOk, withErrorHandler } from "@/lib/api-response";
import { getOrganizationDetail } from "@/modules/organizations/service";

export const GET = withErrorHandler(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const detail = await getOrganizationDetail(request, id);
    return Response.json(apiOk(detail));
  },
);
