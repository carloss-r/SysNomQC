import type { NextRequest } from "next/server";
import { saveSupplier } from "./_save";

export function POST(request: NextRequest) {
  return saveSupplier(request, null);
}
