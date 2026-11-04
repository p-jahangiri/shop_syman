/** Retain decoded captures without erasing their types at later assertion sites. */
export class CapturedValues {
  private readonly values = new Map<string, unknown>();

  set(name: string, value: unknown) {
    this.values.set(name, value);
  }

  read<T>(name: string, schema: { parse: (value: unknown) => T }): T {
    if (!this.values.has(name)) throw new Error(`Missing decoded capture: ${name}`);
    return schema.parse(this.values.get(name));
  }
}
