import { DOMParser, XMLSerializer } from 'xmldom';

const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';
const SUUNTO_ROUTE_NAMESPACE = 'http://www.suunto.com/xmlschemas/RouteExtension/v1';

function getChildElements(parent: Element, namespace: string, name: string): Element[] {
    return Array.from(parent.childNodes).filter((node): node is Element => (
        node.nodeType === 1
        && (node as Element).namespaceURI === namespace
        && (node as Element).localName === name
    ));
}

function normalizeSuuntoRouteRevisionFields(content: Buffer): string | null {
    try {
        let invalidXML = false;
        const rejectXML = () => { invalidXML = true; };
        const document = new DOMParser({
            // Parser diagnostics can include provider content; do not log them.
            errorHandler: { warning: rejectXML, error: rejectXML, fatalError: rejectXML },
        }).parseFromString(new TextDecoder('utf-8', { fatal: true }).decode(content), 'application/xml');
        const root = document.documentElement;
        if (invalidXML || document.doctype || !root
            || root.namespaceURI !== GPX_NAMESPACE || root.localName !== 'gpx') {
            return null;
        }

        let normalizedFields = 0;
        for (const metadata of getChildElements(root, GPX_NAMESPACE, 'metadata')) {
            for (const extensions of getChildElements(metadata, GPX_NAMESPACE, 'extensions')) {
                for (const route of getChildElements(extensions, SUUNTO_ROUTE_NAMESPACE, 'route')) {
                    for (const fieldName of ['modified', 'revision']) {
                        for (const field of getChildElements(route, SUUNTO_ROUTE_NAMESPACE, fieldName)) {
                            // Ignore only the documented scalar revision values at this exact path.
                            // Attributes, nested elements and unexpected values retain their meaning.
                            if (field.attributes.length !== 0
                                || field.childNodes.length !== 1
                                || field.firstChild?.nodeType !== 3
                                || !/^\d+$/.test(field.textContent || '')) {
                                continue;
                            }
                            field.textContent = '';
                            normalizedFields += 1;
                        }
                    }
                }
            }
        }

        return normalizedFields > 0 ? new XMLSerializer().serializeToString(document) : null;
    } catch {
        // An unrecognized or malformed original cannot establish content equality.
        return null;
    }
}

export function hasSameSuuntoRouteContent(storedContent: Buffer, incomingContent: Buffer): boolean {
    if (storedContent.equals(incomingContent)) {
        return true;
    }

    const storedNormalized = normalizeSuuntoRouteRevisionFields(storedContent);
    return storedNormalized !== null
        && storedNormalized === normalizeSuuntoRouteRevisionFields(incomingContent);
}
