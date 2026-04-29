import { isObject } from '@amritk/helpers/is-object';

export type CommentObject = {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
};

export const parseCommentObject = (input: unknown): CommentObject => {
  if (!isObject(input)) return {
        id: "",
        text: "",
        authorId: "",
        createdAt: "",
      };
  const _id = input.id;
  const _text = input.text;
  const _authorId = input.authorId;
  const _createdAt = input.createdAt;
  if (typeof _id === "string" && typeof _text === "string" && typeof _authorId === "string" && typeof _createdAt === "string") return { ...input } as CommentObject;
  return {
    ...input,
    id: typeof _id === "string" ? _id : (_id !== undefined ? String(_id) : ""),
    text: typeof _text === "string" ? _text : (_text !== undefined ? String(_text) : ""),
    authorId: typeof _authorId === "string" ? _authorId : (_authorId !== undefined ? String(_authorId) : ""),
    createdAt: typeof _createdAt === "string" ? _createdAt : (_createdAt !== undefined ? String(_createdAt) : ""),
  } as unknown as CommentObject;
}