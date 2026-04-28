import { array, number, object, optional, string } from '@scalar/validation'

const author = object({
  id: string(),
  name: string(),
  email: string(),
  bio: optional(string()),
})

const comment = object({
  id: string(),
  text: string(),
  authorId: string(),
  createdAt: string(),
})

export const blogPostSchema = object({
  id: string(),
  title: string(),
  content: string(),
  publishedAt: string(),
  viewCount: number(),
  tags: array(string()),
  author,
  comments: array(comment),
})
