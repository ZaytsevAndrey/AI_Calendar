export function generateVerificationCode(): string {
  // Логіка для генерації коду верифікації
  return Math.floor(100000 + Math.random() * 900000).toString();
}
