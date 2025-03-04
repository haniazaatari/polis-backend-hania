const js2xmlparser = require("js2xmlparser");

export function parseToXml(
  rootElement: string,
  data: any,
  options?: any
): string {
  return js2xmlparser.parse(rootElement, data, options);
}
