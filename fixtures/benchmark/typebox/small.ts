import { Type } from '@scalar/typebox'

export const UserSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
  age: Type.Optional(Type.Number()),
  isActive: Type.Boolean(),
})
