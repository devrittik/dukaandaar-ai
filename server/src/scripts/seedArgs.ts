import { validateShopId } from "../storage/tenantDatabase.js";

export function parseShopIdArgument(args: string[], command: string): string {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--shop-id") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--shop-id requires a shop ID.");
      values.push(value);
      index += 1;
    } else if (argument.startsWith("--shop-id=")) {
      values.push(argument.slice("--shop-id=".length));
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(argument)}. Usage: npm run ${command} -- --shop-id <shop_id>`);
    }
  }
  if (values.length !== 1) throw new Error(`A single --shop-id <shop_id> is required. Usage: npm run ${command} -- --shop-id <shop_id>`);
  return validateShopId(values[0]);
}

export function parseSeedShopId(args: string[]): string {
  return parseShopIdArgument(args, "seed");
}
