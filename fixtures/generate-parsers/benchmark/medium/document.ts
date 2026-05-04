import { type AuthorObject, parseAuthorObject, validateAuthorObjectShape } from './author';
import { type CommentObject, parseCommentObject, validateCommentObjectShape } from './comment';
import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

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

export const validateDocumentShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.id === "string"
    && typeof input.title === "string"
    && typeof input.content === "string"
    && typeof input.publishedAt === "string"
    && typeof input.viewCount === "number"
    && Array.isArray(input.tags)
    && validateAuthorObjectShape(input.author)
    && Array.isArray(input.comments) && input.comments.every(validateCommentObjectShape);
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
  const _id = input.id;
  const _title = input.title;
  const _content = input.content;
  const _publishedAt = input.publishedAt;
  const _viewCount = input.viewCount;
  const _tags = input.tags;
  const _author = input.author;
  const _comments = input.comments;
  if (typeof _id === "string" && typeof _title === "string" && typeof _content === "string" && typeof _publishedAt === "string" && typeof _viewCount === "number" && Array.isArray(_tags) && validateAuthorObjectShape(_author) && Array.isArray(_comments) && _comments.every(validateCommentObjectShape)) return { ...input } as Document;
  return {
    ...input,
    id: typeof _id === "string" ? _id : (_id !== undefined ? String(_id) : ""),
    title: typeof _title === "string" ? _title : (_title !== undefined ? String(_title) : ""),
    content: typeof _content === "string" ? _content : (_content !== undefined ? String(_content) : ""),
    publishedAt: typeof _publishedAt === "string" ? _publishedAt : (_publishedAt !== undefined ? String(_publishedAt) : ""),
    viewCount: typeof _viewCount === "number" ? _viewCount : (_viewCount !== undefined ? (Number.isFinite(Number(_viewCount)) ? Number(_viewCount) : 0) : 0),
    tags: Array.isArray(_tags) ? _tags : (_tags !== undefined ? [] : []),
    author: parseAuthorObject(_author),
    comments: validateArray(_comments, parseCommentObject),
  } as unknown as Document;
}