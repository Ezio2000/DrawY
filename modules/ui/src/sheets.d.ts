// A package's stylesheet, as the scoped class names its rules define.
declare module "*.module.css" {
  const sheet: Readonly<Record<string, string>>;
  export default sheet;
}
