export type GdslPrimitive = string | number | boolean | null;

export interface GdslMap {
  [key: string]: GdslValue;
}

export interface GdslList extends Array<GdslValue> {}

export type GdslValue = GdslPrimitive | GdslList | GdslMap | GdslCall;

export interface GdslCall {
  kind: "call";
  name: string;
  args: GdslArgument[];
}

export interface GdslArgument {
  name?: string;
  value: GdslValue;
}

export interface ContributorBlock {
  body: string;
}

export interface ScannedMethodCall {
  call: GdslCall;
  requiresNodeContext: boolean;
}

export type TokenType =
  | "identifier"
  | "string"
  | "number"
  | "("
  | ")"
  | "["
  | "]"
  | ","
  | ":"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
}
