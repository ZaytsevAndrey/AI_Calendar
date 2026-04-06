export default function hasApiErrorCode(error: unknown, codes: number | string | (number | string)[]): boolean {
  const code = (error as any)?.response?.data?.code;
  const codeArr = Array.isArray(codes) ? codes : [codes];
  return codeArr.includes(code);
}
