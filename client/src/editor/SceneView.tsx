import { memo } from 'react';
import { shapeElement, textLineBaselines, transformToString, type AssetNode, type Layer, type Scene, type SceneNode, type TextNode } from '@moniuszko/shared';

type NodeProps = { node: SceneNode; selectable: Set<string>; editingTextId: string | null };

/**
 * Treść grafiki z biblioteki albo element kształtu. Ciąg SVG zmienia się tylko przy zmianie
 * treści lub parametrów, więc React nie przepisuje innerHTML podczas przesuwania.
 */
const AssetContent = memo(function AssetContent({ svg }: { svg: string }) {
  return <g dangerouslySetInnerHTML={{ __html: svg }} />;
});

function TextContent({ node, hidden }: { node: TextNode; hidden: boolean }) {
  const baselines = textLineBaselines(node);
  return (
    <text
      fontFamily={node.fontFamily}
      fontSize={node.fontSize}
      fontWeight={node.fontWeight}
      fontStyle={node.fontStyle}
      fill={node.fill}
      textAnchor={node.anchor}
      xmlSpace="preserve"
      style={hidden ? { visibility: 'hidden' } : undefined}
    >
      {node.text.split('\n').map((line, i) => (
        <tspan key={i} x={0} y={baselines[i]}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

const NodeView = memo(function NodeView({ node, selectable, editingTextId }: NodeProps) {
  const transform = transformToString(node.transform) || undefined;
  const common = {
    'data-node-id': node.id,
    'data-selectable': selectable.has(node.id) ? '1' : undefined,
    transform,
    opacity: node.opacity !== 1 ? node.opacity : undefined,
    display: node.hidden ? 'none' : undefined,
  };
  switch (node.type) {
    case 'asset':
      return (
        <g {...common}>
          <AssetContent svg={(node as AssetNode).svg} />
        </g>
      );
    case 'text':
      return (
        <g {...common}>
          <TextContent node={node} hidden={editingTextId === node.id} />
        </g>
      );
    case 'group':
      return (
        <g {...common}>
          {node.children.map((c) => (
            <NodeView key={c.id} node={c} selectable={selectable} editingTextId={editingTextId} />
          ))}
        </g>
      );
    case 'shape':
      // Ten sam element co w pliku (shapeElement), więc płótno i zapis nie mogą się rozjechać.
      return (
        <g {...common}>
          <AssetContent svg={shapeElement(node)} />
        </g>
      );
    default: {
      const never: never = node;
      throw new Error(`Nieznany typ węzła: ${JSON.stringify(never)}`);
    }
  }
});

function LayerView({ layer, selectable, editingTextId }: { layer: Layer; selectable: Set<string>; editingTextId: string | null }) {
  return (
    <g data-layer-id={layer.id} display={layer.hidden ? 'none' : undefined}>
      {layer.children.map((n) => (
        <NodeView key={n.id} node={n} selectable={selectable} editingTextId={editingTextId} />
      ))}
    </g>
  );
}

/** Zawartość płótna: tło i warstwy w tej samej strukturze co plik kompozycji. */
export function SceneView({ scene, selectable, editingTextId }: { scene: Scene; selectable: Set<string>; editingTextId: string | null }) {
  return (
    <>
      {scene.background !== null && <rect width={scene.width} height={scene.height} fill={scene.background} />}
      {scene.layers.map((l) => (
        <LayerView key={l.id} layer={l} selectable={selectable} editingTextId={editingTextId} />
      ))}
    </>
  );
}
