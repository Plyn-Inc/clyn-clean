class Schema {
  constructor(parser = (value) => value) { this.parser = parser; }
  min() { return this; }
  max() { return this; }
  finite() { return this; }
  positive() { return this; }
  int() { return this; }
  regex() { return this; }
  email() { return this; }
  trim() { return this; }
  optional() { return this; }
  nullable() { return this; }
  default() { return this; }
  refine() { return this; }
  superRefine() { return this; }
  or() { return this; }
  safeParse(value) {
    try { return { success: true, data: this.parser(value) }; }
    catch (error) { return { success: false, error: { issues: [{ message: error?.message || 'invalid' }] } }; }
  }
}

const z = {
  ZodIssueCode: { custom: 'custom' },
  object: () => new Schema((value) => value),
  string: () => new Schema(),
  number: () => new Schema(),
  boolean: () => new Schema(),
  enum: () => new Schema(),
  array: () => new Schema(),
  literal: () => new Schema(),
};

export { z };
