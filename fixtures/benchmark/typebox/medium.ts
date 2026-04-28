import { Type } from '@scalar/typebox'

const Author = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
  bio: Type.Optional(Type.String()),
})

const Comment = Type.Object({
  id: Type.String(),
  text: Type.String(),
  authorId: Type.String(),
  createdAt: Type.String(),
})

export const BlogPostSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  content: Type.String(),
  publishedAt: Type.String(),
  viewCount: Type.Number(),
  tags: Type.Array(Type.String()),
  author: Author,
  comments: Type.Array(Comment),
})
