import bcrypt from 'bcryptjs'

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10)
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash)
}

export function generatePin(existingPins: string[]): string {
  let pin: string
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000))
  } while (existingPins.includes(pin))
  return pin
}
