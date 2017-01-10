const xml2object = require('xml2object');
const fs = require('fs');

const sourceFolder = './fhir-codegen-xsd/';
const destFolder = "./generated/";
const indent = "    ";

var typesCache = {};

// Create or clean the destination folder

if (!fs.existsSync(destFolder))
  fs.mkdirSync(destFolder);

// Processing functions

var processXsd = function(filename)
{
    var parser = new xml2object(["xs:schema"], sourceFolder + filename);

    parser.on("object", function(name, schema) 
    {
        console.log("Pre-processing " + filename + "...");

        var destFile = destFolder + filename.replace(".xsd", ".cs");
        var types = getTypes(schema);

        var text = 
            "using System;\r\n" +
            "using System.Collections.Generic;\r\n\r\n" +
            "namespace Efferent.FHIR.Entities\r\n" +
            "{\r\n" +
            parseTypes(types, null, "") + "\r\n" +
            "}";    

        fs.writeFile(destFile, text);
        console.log("Finished pre-processing.");
    }); 

    parser.start();
}

// Get all the types of a schema object
var getTypes = function(schema)
{
    var simple = getNodes(schema, "xs:simpleType");
    var complex = getNodes(schema, "xs:complexType");

    var associative = {};

    simple.forEach(function(element) {
        element["kind"] = "simple";
        associative[element["name"]] = element;
    });

    complex.forEach(function(element) {
        element["kind"] = "complex";
        associative[element["name"]] = element;
    });

    return associative;
}

// Parses a complex type
var parseComplexType = function(schemaTypes, typeDef, margin, alias)
{
    var text = "";
    var complex = typeDef["xs:complexContent"] || {};
    var base, sequence, attribute;
    var name = typeDef["name"];

    if (complex.hasOwnProperty("xs:restriction"))
    {
        var restriction = complex["xs:restriction"];
        base = restriction["base"] || null;
        sequence = restriction["xs:sequence"] || {};
        attribute = restriction["xs:attribute"] || {};
    }
    else if (complex.hasOwnProperty("xs:extension"))
    {
        var extension = complex["xs:extension"];
        base = extension["base"] || null;
        sequence = extension["xs:sequence"] || {};
        attribute = extension["xs:attribute"] || {};
    }
    else if (typeDef.hasOwnProperty("xs:sequence"))
    {
        base = null;
        sequence = typeDef["xs:sequence"] || {};
        attribute = typeDef["xs:attribute"] || {};
    }
    else
        return "";

    if (Object.keys(sequence).length == 0) // not a real class, may be an enumeration
    {
        if (attribute.hasOwnProperty("type"))
        {
            var singleType = {};
            singleType[attribute["type"]] = schemaTypes[attribute["type"]];

            var typeContent = parseTypes(singleType, attribute["type"], margin, normalizeIdentifier(name));

            if (typeContent.length > 0)
            {
                text = buildSummary(typeDef, margin);
                text += typeContent;
            }
        }
    }
    else // it is a class
    {
        var isComponent = name.indexOf('.') > -1;

        text = "";
        if (isComponent)
        {
            text = margin + "public partial class " + identifierBase(name) + "\r\n" +
                margin + "{\r\n"; 
            margin += indent;
        }

        var className = normalizeIdentifier(name);
        var classCache = (base == null || !typesCache[base]) ? {} : JSON.parse(JSON.stringify(typesCache[base]));

        text += buildSummary(typeDef, margin);
        text += margin + "public " + (isComponent ? "" : "partial ") + "class " + className + (base==null ? "" : " : " + base) + "\r\n" + 
            margin + "{\r\n";

        var elements = getNodes(sequence, "xs:element");
        elements.forEach(function(element) {
            if (!element["type"])
                return;

            var originalTypeName = element["type"].replace('-', '_');
            var propertyType = parsePropertyType(element);

            var propName = toTitleCase(element["name"]);
            classCache[propName] = propertyType;

            if (base != null && typesCache.hasOwnProperty(base))
            {
                if (typesCache[base].hasOwnProperty(propName))   // avoid property override
                    return;
            } 

            text += buildSummary(element, margin + indent);

            if (isList(element))
                text += margin + indent  + "public List<" + propertyType + "> " + propName + " { get; set; }\r\n";
            else
                text += margin + indent  + "public " + propertyType + " " + propName + " { get; set; }\r\n";

            text += "\r\n";
        });

        text += margin + "}\r\n";

        if (isComponent)
        {
            margin = margin.substring(0, margin.length - indent.length);
            text += margin + "}\r\n";
        }
        else
        {
            typesCache[className] = classCache;
        }
    }    

    return text;
}

var enumValueMapping = {
    "=": "Equal",
    ">": "GreaterThan",
    ">=": "GreaterOrEqual",
    "<": "LessThan",
    "<=": "LessOrEqual"
}

var parseEnumeration = function(schemaTypes, typeDef, margin, alias)
{
    var text = "";

    var restriction = typeDef["xs:restriction"];
    var enumValues = getNodes(restriction, "xs:enumeration");

    if (enumValues.length > 0)
    {
        text += buildSummary(typeDef, margin);

        text += margin + "public enum " + (alias || name) + "\r\n";
        text += margin + "{\r\n";

        var values = []
        enumValues.forEach(function(enumValue)
        {
            var text1 = buildSummary(enumValue, margin + indent);

            var value = enumValue["value"];
            if (enumValueMapping.hasOwnProperty(value))
                value = enumValueMapping[value];
            else if (/\d/.test(value))
                value = 'N' + value;                
            else
                value = toTitleCase(value);
            text1 += margin + indent + value;

            values.push(text1);
        }); 

        text += values.join(",\r\n") + "\r\n";
        text += margin + "}\r\n";
    }

    return text;
}

// Parses all the types in a collection
var parseTypes = function(allTypes, mainType, margin, alias)
{
    var text = "";
    var embed = "";

    for (name in allTypes)
    {
        var isMainType = name == mainType;
        var typeDef = allTypes[name];

        if (typeDef["kind"] == "complex")  // It's a class (maybe)
        {
            if (isMainType)
                text += parseComplexType(allTypes, typeDef, margin, alias || name);
            else
                embed += parseComplexType(allTypes, typeDef, margin + indent, alias).replace("// <nested>", "");
        }
        else if (typeDef.hasOwnProperty("xs:restriction") && alias !== undefined)  // It's an enumeration wrapped by a complex type
        {
            text += parseEnumeration(allTypes, typeDef, margin, alias);
        }
    }

    if (embed.length > 0)
    {
        if (mainType == null)
            text = embed;
        else
            text = text.replace("// <nested>", embed);
    }

    return text;
}

var typeMapping = {
    "string": "string",
    "oid": "string",
    "id": "string",
    "uuid": "string",
    "markdown": "string",
    "uri": "string",
    "code": "string",
    "date": "?DateTime",
    "dateTime": "?DateTime",
    "time": "?TimeSpan",
    "instant": "?DateTimeOffset",
    "positiveInt": "?int",
    "unsignedInt": "?int",
    "integer": "?int",
    "decimal": "?double",
    "base64Binary": "byte[]",
    "boolean": "?bool",
    "SampledDataDataType": "string"
}

// Evaluates a property definition and determines if it is a primitive type
var parsePropertyType = function(element)
{
    var type = normalizeIdentifier(element["type"]);

    if (typeMapping.hasOwnProperty(type))
    {
        var native = typeMapping[type];
        if (native.charAt(0) == '?')
        {
            native = native.substring(1);
            if (isNullable(element))
                native += "?";
        }
        return native;
    }

    return type;
}

var normalizeIdentifier = function(name)
{
    var type = name.replace('-', '_');

    if (type.indexOf('.') > -1)
        type = type.substring(type.lastIndexOf('.')+1) + "Component";        

    if (type == "Reference")  // special case
        type = "ResourceReference"

    return type;
}

var identifierBase = function(name)
{
    var type = name.replace('-', '_');

    type = type.substring(0, type.indexOf('.'));

    return type;                
}

var isNullable = function(element)
{
    var minOccurs = element["minOccurs"] || "1";
    return minOccurs == "0";    
}

var isList = function(element)
{
    var minOccurs = element["minOccurs"] || "1";
    var maxOccurs = element["maxOccurs"] || "1";

    if (parseInt(minOccurs > 1))
        return true;

    if (maxOccurs == "unbounded")
        return true;

    if (parseInt(maxOccurs > 1))
        return true;

    return false;        
}

var toTitleCase = function(text)
{
    return text.split('-').map(i => i[0].toUpperCase() + i.substring(1)).join('') 
}

// Gets a list of one or more XML nodes with the same tag
var getNodes = function(schema, nodeTag, subNode)
{
    var list = [];

    if (schema.hasOwnProperty(nodeTag))
    {
        var nodes = schema[nodeTag];

        if (subNode)
        {
            if (Array.isArray(nodes))
                nodes.forEach(function(element) {list.push(element[subNode]);}); // array of nodes      
            else
                list.push(nodes[subNode]);  // single node
        }
        else
        {
            if (Array.isArray(nodes))
                nodes.forEach(function(element) {list.push(element);}); // array of nodes      
            else
                list.push(nodes);  // single node
        }
    }
    
    return list;
}

// Get a list of documentation lines, and split properly
var getDocumentation = function(element)
{
    if (!element.hasOwnProperty("xs:annotation"))
        return [];

    var annotation = element["xs:annotation"];    
    var nodes = getNodes(annotation, "xs:documentation", "$t");

    var lines = [];
    nodes.forEach(function(element)
    {
        if (element !== undefined)
        {
            element.match(/[^\r\n]+/g).forEach(function(line) { 
                lines.push(line);
            })
        }
    }); 

    return lines;
}

// Build a summary section for a type or member
var buildSummary = function(element, margin)
{
    var doc = getDocumentation(element);

    if (doc.length == 0)
        return "";

    var hasSummary = false;
    var summary = margin + "/// <summary>\r\n";
    doc.forEach(function(element) {
        summary += margin + "/// " + element + "\r\n";
        hasSummary = true;
    });
    summary += margin + "/// </summary>\r\n";

    return summary;
}

// Process all FHIR entities

processXsd("fhir-single.xsd");
