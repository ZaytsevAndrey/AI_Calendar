export class ApiError extends Error {
  code: string;
  fields?: Record<string, string>;

  constructor(code: string, fields?: Record<string, string>) {
    super(code);
    this.code = code;
    this.fields = fields;
  }
}
