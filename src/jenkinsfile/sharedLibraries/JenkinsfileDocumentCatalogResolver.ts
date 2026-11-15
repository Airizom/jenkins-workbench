import type * as vscode from "vscode";
import type {
  JenkinsfileCatalogSource,
  JenkinsfileSharedLibrarySource,
  JenkinsfileStepCatalog,
  JenkinsfileStepCatalogResult,
  JenkinsfileStepDefinition
} from "../JenkinsfileIntelligenceTypes";
import { getJenkinsfileDocumentModel } from "../model/JenkinsfileDocumentModelCache";

type VarsMap = ReadonlyMap<string, JenkinsfileStepDefinition>;

interface MergedCatalog {
  layers: readonly VarsMap[];
  catalog: JenkinsfileStepCatalog;
}

export type JenkinsfileDocumentCatalogLibraryIndex = Pick<
  JenkinsfileSharedLibrarySource,
  "getLibraries" | "getVars" | "isVarsFile" | "findLibraryForVarsFile"
>;

/**
 * Adds the shared library vars a document can use to the step catalog: implicit libraries,
 * then libraries referenced by `@Library`/`library`, or a vars file's own library. Library
 * vars shadow same-named steps.
 */
export class JenkinsfileDocumentCatalogResolver implements JenkinsfileCatalogSource {
  /** Last merge per base catalog, reused while the same vars maps apply. */
  private readonly merged = new WeakMap<JenkinsfileStepCatalog, MergedCatalog>();

  constructor(
    private readonly stepCatalogSource: JenkinsfileCatalogSource,
    private readonly libraryIndex: JenkinsfileDocumentCatalogLibraryIndex
  ) {}

  async getCatalogForDocument(
    document: vscode.TextDocument
  ): Promise<JenkinsfileStepCatalogResult> {
    const [base, layers] = await Promise.all([
      this.stepCatalogSource.getCatalogForDocument(document),
      this.resolveVarLayers(document)
    ]);
    if (layers.length === 0) {
      return base;
    }
    return { ...base, catalog: this.mergeCatalog(base.catalog, layers) };
  }

  private async resolveVarLayers(document: vscode.TextDocument): Promise<VarsMap[]> {
    const libraries = await this.libraryIndex.getLibraries();
    if (libraries.length === 0) {
      return [];
    }
    const names: string[] = libraries
      .filter((library) => library.implicit)
      .map((library) => library.name);

    if (this.libraryIndex.isVarsFile(document.uri)) {
      const own = await this.libraryIndex.findLibraryForVarsFile(document.uri);
      if (own) {
        names.push(own.name);
      }
    } else {
      for (const ref of getJenkinsfileDocumentModel(document).libraryRefs) {
        names.push(ref.name.trim());
      }
    }

    const known = new Set(libraries.map((library) => library.name));
    const ordered = [...new Set(names)].filter((name) => known.has(name));
    const layers = await Promise.all(ordered.map((name) => this.libraryIndex.getVars(name)));
    return layers.filter((vars): vars is VarsMap => vars !== undefined && vars.size > 0);
  }

  private mergeCatalog(
    base: JenkinsfileStepCatalog,
    layers: readonly VarsMap[]
  ): JenkinsfileStepCatalog {
    const cached = this.merged.get(base);
    if (cached && sameLayers(cached.layers, layers)) {
      return cached.catalog;
    }
    const steps = new Map(base.steps);
    for (const vars of layers) {
      for (const [name, definition] of vars) {
        steps.set(name, definition);
      }
    }
    const catalog: JenkinsfileStepCatalog = { steps, directives: base.directives };
    this.merged.set(base, { layers, catalog });
    return catalog;
  }
}

function sameLayers(left: readonly VarsMap[], right: readonly VarsMap[]): boolean {
  return left.length === right.length && left.every((layer, index) => layer === right[index]);
}
