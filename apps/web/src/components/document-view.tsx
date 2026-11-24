import type { DocContent, DocNode } from "@escolar/shared";
import type { CSSProperties, ReactNode } from "react";

/**
 * El documento tal como se ve y se imprime, sin el editor. Se arma con elementos de React a partir
 * del JSON guardado (que ya viene validado): nunca se inserta HTML.
 */
export function DocumentView({ content }: { content: DocContent }) {
  return <div className="doc-content">{renderNodes(content.content)}</div>;
}

const alignOf = (node: DocNode): CSSProperties | undefined =>
  node.attrs?.textAlign && node.attrs.textAlign !== "left" ? { textAlign: node.attrs.textAlign } : undefined;

function renderText(node: DocNode): ReactNode {
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out = <strong>{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "underline") out = <u>{out}</u>;
  }
  return out;
}

function renderNodes(nodes: DocNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((node, i) => {
    // Los nodos no tienen id propio; su lugar en el documento es estable al mostrarlo.
    const key = `${node.type}-${i}`;
    const children = renderNodes(node.content);
    switch (node.type) {
      case "text":
        return <span key={key}>{renderText(node)}</span>;
      case "paragraph":
        return (
          <p key={key} style={alignOf(node)}>
            {children.length ? children : <br />}
          </p>
        );
      case "heading": {
        const level = node.attrs?.level ?? 1;
        const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
        return (
          <Tag key={key} style={alignOf(node)}>
            {children}
          </Tag>
        );
      }
      case "bulletList":
        return <ul key={key}>{children}</ul>;
      case "orderedList":
        return (
          <ol key={key} start={node.attrs?.start ?? 1}>
            {children}
          </ol>
        );
      case "listItem":
        return <li key={key}>{children}</li>;
      case "blockquote":
        return <blockquote key={key}>{children}</blockquote>;
      case "hardBreak":
        return <br key={key} />;
      case "horizontalRule":
        return <hr key={key} />;
      case "table":
        return (
          <table key={key}>
            <tbody>{children}</tbody>
          </table>
        );
      case "tableRow":
        return <tr key={key}>{children}</tr>;
      case "tableHeader":
        return (
          <th key={key} colSpan={node.attrs?.colspan ?? 1} rowSpan={node.attrs?.rowspan ?? 1}>
            {children}
          </th>
        );
      case "tableCell":
        return (
          <td key={key} colSpan={node.attrs?.colspan ?? 1} rowSpan={node.attrs?.rowspan ?? 1}>
            {children}
          </td>
        );
      default:
        return null;
    }
  });
}
