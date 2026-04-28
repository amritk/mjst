import { boolean, number, object, optional, string } from '@scalar/validation'

export const userSchema = object({
  id: string(),
  name: string(),
  email: string(),
  age: optional(number()),
  isActive: boolean(),
})
