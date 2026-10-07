declare module 'occt-import-js' {
  interface OcctMesh {
    name: string
    attributes: { position: { array: ArrayLike<number> } }
    index: { array: ArrayLike<number> }
  }
  interface OcctResult {
    success: boolean
    meshes: OcctMesh[]
  }
  interface OcctParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value'
    linearDeflection?: number
    angularDeflection?: number
  }
  interface Occt {
    ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult
  }
  const occtimportjs: () => Promise<Occt>
  export default occtimportjs
}
