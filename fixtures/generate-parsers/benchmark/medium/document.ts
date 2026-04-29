import { type AuthorObject, parseAuthorObject } from './author';
import { type CommentObject, parseCommentObject } from './comment';
import { validateArray } from 'mjst-helpers/validate-array';
import { isObject } from 'mjst-helpers/is-object';

export type Document = {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
  viewCount: number;
  tags: string[];
  author: AuthorObject;
  comments: CommentObject[];
};

export const parseDocument = (input: unknown): Document => {
  if (!isObject(input)) return {
        id: "",
        title: "",
        content: "",
        publishedAt: "",
        viewCount: 0,
        tags: [],
        author: parseAuthorObject(undefined),
        comments: [],
      };
  const _author = input.author;
  const _comments = input.comments;
  return {
    ...input,
    id: typeof input?.id === "string" ? input?.id : (input?.id !== undefined ? String(input?.id) : ""),
    title: typeof input?.title === "string" ? input?.title : (input?.title !== undefined ? String(input?.title) : ""),
    content: typeof input?.content === "string" ? input?.content : (input?.content !== undefined ? String(input?.content) : ""),
    publishedAt: typeof input?.publishedAt === "string" ? input?.publishedAt : (input?.publishedAt !== undefined ? String(input?.publishedAt) : ""),
    viewCount: typeof input?.viewCount === "number" ? input?.viewCount : (input?.viewCount !== undefined ? (Number.isFinite(Number(input?.viewCount)) ? Number(input?.viewCount) : 0) : 0),
    tags: Array.isArray(input?.tags) ? input?.tags : (input?.tags !== undefined ? [] : []),
    author: parseAuthorObject(_author),
    comments: validateArray(_comments, parseCommentObject),
  } as unknown as Document;
}