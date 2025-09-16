import { resolve } from 'dns';
import * as vscode from 'vscode';
import * as pol from './polarion';
import * as utils from './utils';
import * as path from 'path';
import * as fs from 'fs';

const decorationType = vscode.window.createTextEditorDecorationType({});
const open = require('open');

export class PolarionHoverProvider implements vscode.HoverProvider {
  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const regex = utils.getWorkitemRegex();
    const wordRange = document.getWordRangeAtPosition(position, regex);
    if (!wordRange) {
      return undefined;
    }

    const workItem = document.getText(wordRange);
    if (!utils.isValidWorkItem(workItem)) {
      return undefined;
    }

    const hoverContent = await buildHoverMarkdown(workItem);
    return new vscode.Hover(hoverContent, wordRange);
  }
}

export class PolarionCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    const regex = utils.getWorkitemRegex();
    
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const line = document.lineAt(lineIndex);
      let match;
      
      // Reset regex lastIndex for each line
      regex.lastIndex = 0;
      
      while ((match = regex.exec(line.text)) !== null) {
        const workItem = match[0];
        if (utils.isValidWorkItem(workItem)) {
          const range = new vscode.Range(
            lineIndex, 
            match.index, 
            lineIndex, 
            match.index + workItem.length
          );
          
          const codeLens = new vscode.CodeLens(range, {
            title: `Open ${workItem} in Polarion`,
            command: 'vscode-polarion.openWorkItemUrl',
            arguments: [workItem]
          });
          
          codeLenses.push(codeLens);
        }
      }
    }
    
    return codeLenses;
  }
}

export async function decorate(editor: vscode.TextEditor) {
  let decorationColor = utils.getDecorateColor();
  let decorationsArray: vscode.DecorationOptions[] = [];

  let items = utils.mapItemsInDocument(editor);

  for (const item of items) {
    var title = await utils.getWorkItemText(item[0]);
    let renderOptionsDark = { after: { contentText: title, color: decorationColor, margin: '50px' } };
    let renderOptions = { light: renderOptionsDark, dark: renderOptionsDark };

    for (const itemRange of item[1]) {
      let range = new vscode.Range(itemRange.start.line, 200, itemRange.end.line, 201);
      let afterLineDecoration = { range, renderOptions };
      decorationsArray.push(afterLineDecoration);
    }
  }
  editor.setDecorations(decorationType, decorationsArray);
}

export async function buildHoverMarkdown(workItem: string): Promise<vscode.MarkdownString[]> {
  let item = await pol.polarion.getWorkItem(workItem);
  let url = await pol.polarion.getUrlFromWorkItem(workItem);
  let hover: vscode.MarkdownString[] = [];
  if (item !== undefined) {
    // Build status text with icon if available
    let statusText = item.status?.name || item.status?.id || 'unknown';
    if (item.status?.iconPath) {
      statusText = `![status](${item.status.iconPath}) ${statusText}`;
    }
    
    // Build workitem type text with icon if available
    let typeText = item.type?.name || item.type?.id || 'unknown';
    if (item.type?.iconPath) {
      typeText = `![type](${item.type.iconPath}) ${typeText}`;
    }
    
    // Build author text using shared function
    const authorText = utils.buildAuthorDisplayText(item.author);
    
    hover.push(new vscode.MarkdownString(`${workItem} (${typeText}) ***${item.title}***  \nAuthor: ${authorText}  \nStatus: ${statusText}`));
    if (item.description) {
      // Process images in the description before creating the MarkdownString
      const processedContent = await utils.preprocessWorkitemDescription(item.description.content, item);
      let content = new vscode.MarkdownString(processedContent);
      content.supportHtml = true;
      hover.push(content);
    }
    hover.push(new vscode.MarkdownString(`[Open in Polarion](${url})`));
  }
  else {
    hover.push(new vscode.MarkdownString(`Not found`));
  }
  return hover;
}

export async function handleOpenPolarion() {
  const editor = vscode.window.activeTextEditor;
  if (editor !== undefined) {
    if (editor.selection.isEmpty) {
      // the Position object gives you the line and character where the cursor is
      const position = editor.selection.active;

      let items = utils.listItemsInDocument(editor);

      let selectedItem = items.find((value) => {
        if (value.range.contains(position)) {
          return 1;
        }
      });

      if (selectedItem) {
        open(await pol.polarion.getUrlFromWorkItem(selectedItem.name));
      }
    }
  }
}
