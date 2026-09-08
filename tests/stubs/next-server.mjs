export class NextRequest {}
export class NextResponse {
  static json(body, init = {}) {
    return {
      body,
      status: init.status ?? 200,
      async json() { return body; },
    };
  }
}
