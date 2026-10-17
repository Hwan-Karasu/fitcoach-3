/** Картинки, подключаемые через import: Metro возвращает числовой id ресурса. */
declare module "*.png" {
  const resource: number;
  export default resource;
}
