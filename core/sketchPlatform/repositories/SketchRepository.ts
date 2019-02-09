import * as fs from 'fs-extra';
import * as ns from 'node-sketch';
import * as _ from 'lodash';
import { SketchLayerType } from '../entities/SketchLayerType';
import { injectable } from 'inversify';
import * as dotenv from 'dotenv';
import * as cp from 'child_process';
import * as path from 'path';
import * as uuidv4 from 'uuid/v4';
import '../../extensions/String.extensions';
import { Container } from '../../domain/entities/Container';
import { SketchParser } from '../applications/SketchParser';
import { Rect } from '../../domain/entities/Rect';
import { PathManager, OutputType } from '../../utilities/PathManager';
import { TreeElement } from '../../domain/entities/TreeElement';

dotenv.config();
if (dotenv.error) {
  throw dotenv.error;
}

export interface ISketchRepository {
  getAll(inputPath: string): Promise<Node[]>;
  extractAll(inputPath: string, outputDir?: string): Promise<void>;
  extractSlices(inputPath: string, outputDir?: string): void;
}

@injectable()
export class SketchRepository implements ISketchRepository {
  constructor() {}

  /**
   * Private methods
   */

  /**
   * recursively lookup config json from
   * command executed directory to upper directories.
   * @param jsonPath {string?} path to config json
   * @return sketch {string?} sketch config object
   */
  private getConfig(jsonPath?: string): Object | null {
    const targetPath = jsonPath || process.env.CONFIG_PATH;
    const absolutePath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(process.cwd(), targetPath);

    if (fs.existsSync(absolutePath)) {
      const jsonObj = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
      return jsonObj.sketch;
    } else if (path.dirname(absolutePath) === '/') {
      throw new Error('no config file');
    }

    const upperFilePath = path.join(
      path.dirname(absolutePath),
      '../',
      path.basename(absolutePath),
    );
    return this.getConfig(upperFilePath);
  }

  /**
   * get sketch file object from which extract metadata and asset files
   * return {Promise<any>} node-sketch object which express sketch file.
   */
  private async getTargetSketch(inputPath: string): Promise<any> {
    const absolutePath = this.absolutePath(inputPath);
    if (!absolutePath) return;
    return await ns.read(absolutePath);
  }

  private absolutePath(pathOrDir: string): string {
    const absolutePath = path.isAbsolute(pathOrDir)
      ? pathOrDir
      : path.resolve(process.cwd(), pathOrDir);
    if (!absolutePath) return null;
    return absolutePath;
  }

  /**
   * add constraint values(numbers) which represents relative position from parent view
   * @param outputs {any[]} An array of [ Container | View | subclass of View ]
   */
  private addConstraintValues(props: object): void {
    if (!props) return;

    for (const key of Object.keys(props)) {
      const output = props[key];
      if (!output.constraints) continue;
      let baseView: any;

      for (const propKey of Object.keys(props)) {
        const prop = props[propKey];
        // todo: 現状、parentIdがある場合、同じartboardに属していて、親子関係にあるviewを親として認めているが、
        // これだけだとかぶる場合が大いにあるので、ユニークさを保つために対応が必要。
        const isParent = output.parentId
          ? prop.id === output.parentId &&
            (prop.id === output.containerId ||
              prop.containerId === output.containerId)
          : prop.id === output.containerId;
        if (isParent) {
          baseView = prop;
          break;
        }
      }
      if (!baseView) continue;
      const originalRect: Rect =
        baseView.type === 'Container' ? baseView.rect : baseView.originalRect;
      // calculate margins from each sides
      let newConstraints = {};
      if (output.constraints.top) {
        newConstraints['top'] = output.rect.y.toString();
      }
      if (output.constraints.right) {
        newConstraints['right'] = (-(
          originalRect.width -
          (output.rect.x + output.rect.width)
        )).toString();
      }
      if (output.constraints.bottom) {
        newConstraints['bottom'] = (-(
          originalRect.height -
          (output.rect.y + output.rect.height)
        )).toString();
      }
      if (output.constraints.left) {
        newConstraints['left'] = output.rect.x.toString();
      }
      if (output.constraints.width) {
        newConstraints['width'] = output.rect.width.toString();
      }
      if (output.constraints.height) {
        newConstraints['height'] = output.rect.height.toString();
      }
      output.constraints = newConstraints;
    }
  }

  private checkIntegrity(
    node: TreeElement,
    metadataJson: Object,
    matched: [string?],
    errors: [string?],
  ) {
    let result = false;
    for (const key of Object.keys(metadataJson)) {
      if (key === node.uid) {
        result = true;
      }
    }
    if (result) {
      matched.push(node.uid);
    } else {
      errors.push(node.uid);
    }

    if (node.elements && node.elements.length > 0) {
      for (const aNode of node.elements) {
        this.checkIntegrity(aNode, metadataJson, matched, errors);
      }
    }
  }

  /**
   * interface implementation
   */

  /// retrieve all artboards the sketch file has.
  async getAll(inputPath: string): Promise<Node[]> {
    const sketch = await this.getTargetSketch(inputPath);
    const pages = sketch.pages;
    const nodes = [];
    for (const page of pages) {
      if (page.name === 'Symbols') continue;
      const instances = page.getAll(SketchLayerType.Artboard);
      if (!instances) continue;
      nodes.push(instances);
    }
    const result = [].concat(...nodes); // lessen dimension
    return result;
  }

  /// Extract all elements which belongs to each artboards. No validation because we assume it's already linted.
  async extractAll(inputPath: string, outputDir?: string): Promise<void> {
    const sketch = await this.getTargetSketch(inputPath);
    const pathManager = new PathManager(outputDir);

    // extract all images within 'Pages'(not in 'Symbols')
    const imagesDirName = pathManager.getOutputPath(OutputType.images, true);
    sketch.use(new ns.plugins.ExportImages(imagesDirName));

    // extract all artboards
    const artboards = await this.getAll(inputPath);
    const props: object = {};
    const treeElements: [TreeElement?] = [];
    const sketchParser = new SketchParser(sketch, this.getConfig(), outputDir);

    artboards.forEach(artboard => {
      if (!artboard['name']) return; // same as continue
      let artboardName = artboard['name'];

      const uid = uuidv4();
      const aTree: TreeElement = new TreeElement(uid, artboardName);
      const container: Container = new Container(artboard);
      // todo: パターンマッチによる名前の抽出
      container.name = artboard['name'].toLowerCamelCase('/');
      aTree.name = container.name;
      props[uid] = container;

      artboard['layers'].forEach(node => {
        sketchParser.parseLayer(node, 1, props, aTree);
      });
      treeElements.push(aTree);
    });

    this.addConstraintValues(props);

    const errors: [string?] = [];
    let matched: [string?] = [];
    const elementTotalCount: number = Object.keys(props).length;
    for (const element of treeElements) {
      this.checkIntegrity(element, props, matched, errors);
    }
    if (matched.length !== elementTotalCount) {
      throw new Error(
        `extracted jsons have some unintegrity: ${errors.map(error => error)}`,
      );
    }

    const metadataPath = pathManager.getOutputPath(OutputType.metadata, true);
    fs.writeFileSync(metadataPath, JSON.stringify(props));

    const treePath = pathManager.getOutputPath(OutputType.tree, true);
    fs.writeFileSync(treePath, JSON.stringify(treeElements));
  }

  extractSlices(inputPath: string, outputDir?: string): void {
    const absoluteInputPath = this.absolutePath(inputPath);
    const pathManager = new PathManager(outputDir);
    if (!absoluteInputPath) return;
    const execSync = cp.execSync;
    const dirPath = pathManager.getOutputPath(OutputType.slices, true);
    let command = process.env.SKETCH_TOOL_PATH;
    command += ' export slices ';
    command += absoluteInputPath;
    command += ' --formats=pdf'; //png,svg
    // command += ' --scales=1,2,3';
    command += ' --output=' + dirPath;

    execSync(command);

    // `export slices` command may make leading/trailing spaces, so remove these.
    pathManager.removeWhiteSpaces(dirPath);
  }
}
