declare module "plantuml-encoder" {
  const encoder: { encode: (source: string) => string };
  export default encoder;
}
