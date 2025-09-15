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

async function processWorkitemImages(htmlContent: string, workItem: pol.PolarionWorkItem): Promise<string> {
  // Regular expression to find img tags with workitemimg: src
  const imgRegex = /<img[^>]+src="workitemimg:([^"]+)"[^>]*>/gi;
  let processedContent = htmlContent;
  let match;

  while ((match = imgRegex.exec(htmlContent)) !== null) {
    const attachmentId = match[1];
    const fullImgTag = match[0];
    
    try {
      // Download the image using the workitem's downloadAttachment method
      const imageData = await workItem.downloadAttachment(attachmentId);
      
      if (imageData) {
        // Create a data URI for the image
        const mimeType = getImageMimeType(attachmentId);
        const dataUri = `data:${mimeType};base64,${imageData}`;
        
        // Replace the workitemimg: src with the data URI
        const updatedImgTag = fullImgTag.replace(/src="workitemimg:[^"]+"/i, `src="${dataUri}"`);
        processedContent = processedContent.replace(fullImgTag, updatedImgTag);
      }
    } catch (error) {
      console.error(`Failed to download image ${attachmentId} for workitem ${workItem.id}:`, error);
      // Keep the original img tag if download fails
    }
  }
  
  return processedContent;
}

function getImageMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/png'; // Default fallback
  }
}

export async function buildHoverMarkdown(workItem: string): Promise<vscode.MarkdownString[]> {
  let item = await pol.polarion.getWorkItem(workItem);
  let url = await pol.polarion.getUrlFromWorkItem(workItem);
  let hover: vscode.MarkdownString[] = [];
  if (item !== undefined) {
    hover.push(new vscode.MarkdownString(`${workItem} (${item.type.id}) ***${item.title}***  \nAuthor: ${item.author.id}  \n Status: ${item.status.id}`));
    if (item.description) {
      // Process images in the description before creating the MarkdownString
      const processedContent = await processWorkitemImages(item.description.content, item);
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
