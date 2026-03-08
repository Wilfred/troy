import { docs_v1, drive_v3, google } from "googleapis";
import { log } from "./logger.js";

function createGoogleDocsClient(): docs_v1.Docs {
  const auth = createAuth();
  return google.docs({ version: "v1", auth });
}

function createGoogleDriveClient(): drive_v3.Drive {
  const auth = createAuth();
  return google.drive({ version: "v3", auth });
}

function createAuth(): InstanceType<typeof google.auth.OAuth2> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Docs requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables.",
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

function extractTextFromDocument(doc: docs_v1.Schema$Document): string {
  const body = doc.body;
  if (!body?.content) return "";

  let text = "";
  for (const element of body.content) {
    text += extractTextFromStructuralElement(element);
  }
  return text;
}

function extractTextFromStructuralElement(
  element: docs_v1.Schema$StructuralElement,
): string {
  if (element.paragraph) {
    let paragraphText = "";
    for (const elem of element.paragraph.elements ?? []) {
      if (elem.textRun?.content) {
        paragraphText += elem.textRun.content;
      }
    }
    return paragraphText;
  }
  if (element.table) {
    let tableText = "";
    for (const row of element.table.tableRows ?? []) {
      const cells: string[] = [];
      for (const cell of row.tableCells ?? []) {
        let cellText = "";
        for (const content of cell.content ?? []) {
          cellText += extractTextFromStructuralElement(content);
        }
        cells.push(cellText.trim());
      }
      tableText += cells.join(" | ") + "\n";
    }
    return tableText;
  }
  if (element.sectionBreak) {
    return "\n";
  }
  return "";
}

async function listDocs(args: {
  owner_email?: string;
  max_results?: number;
  query?: string;
}): Promise<string> {
  const drive = createGoogleDriveClient();
  const maxResults = args.max_results ?? 20;

  const queryParts = ["mimeType='application/vnd.google-apps.document'"];
  if (args.owner_email) {
    queryParts.push(`'${args.owner_email}' in owners`);
  }
  if (args.query) {
    queryParts.push(`fullText contains '${args.query}'`);
  }

  const response = await drive.files.list({
    q: queryParts.join(" and "),
    pageSize: maxResults,
    fields: "files(id, name, modifiedTime, owners)",
    orderBy: "modifiedTime desc",
  });

  const files = response.data.files;
  if (!files || files.length === 0) {
    return "No Google Docs found matching the criteria.";
  }

  let result = `Found ${files.length} document(s):\n\n`;
  for (const file of files) {
    result += `ID: ${file.id}\n`;
    result += `Title: ${file.name}\n`;
    if (file.modifiedTime) {
      result += `Modified: ${file.modifiedTime}\n`;
    }
    if (file.owners && file.owners.length > 0) {
      const ownerNames = file.owners
        .map(
          (o: { displayName?: string | null; emailAddress?: string | null }) =>
            o.displayName ?? o.emailAddress,
        )
        .join(", ");
      result += `Owner: ${ownerNames}\n`;
    }
    result += "\n";
  }

  return result.trimEnd();
}

async function readDoc(args: { document_id: string }): Promise<string> {
  const docs = createGoogleDocsClient();

  const response = await docs.documents.get({
    documentId: args.document_id,
  });

  const doc = response.data;
  const title = doc.title ?? "(untitled)";
  const content = extractTextFromDocument(doc);

  return `Title: ${title}\n\n${content}`;
}

export const docsTools = [
  {
    type: "function" as const,
    function: {
      name: "list_google_docs",
      description:
        "List Google Docs accessible to the user, optionally filtered by owner email or search query. Use this when the user asks about their documents or wants to find a specific doc.",
      parameters: {
        type: "object",
        properties: {
          owner_email: {
            type: "string",
            description:
              "Filter documents by owner email address. Use this to find docs owned by a specific user.",
          },
          max_results: {
            type: "number",
            description: "Maximum number of documents to return (default: 20).",
          },
          query: {
            type: "string",
            description:
              "Search query to filter documents by content or title.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_google_doc",
      description:
        "Read the full text content of a Google Doc by its document ID. Use this when the user wants to see the contents of a specific document.",
      parameters: {
        type: "object",
        properties: {
          document_id: {
            type: "string",
            description:
              "The ID of the Google Doc to read (obtained from list_google_docs or from the document URL).",
          },
        },
        required: ["document_id"],
      },
    },
  },
];

export async function handleDocsToolCall(
  name: string,
  argsJson: string,
): Promise<string | null> {
  if (name === "list_google_docs") {
    log.info("Listing Google Docs");
    const args = JSON.parse(argsJson) as {
      owner_email?: string;
      max_results?: number;
      query?: string;
    };
    return await listDocs(args);
  }

  if (name === "read_google_doc") {
    log.info("Reading Google Doc");
    const args = JSON.parse(argsJson) as { document_id: string };
    return await readDoc(args);
  }

  return null;
}
