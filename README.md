# FHIR-dotnetcore
FHIR DSTU-2 entities compatible with .Net Core and Visual Studio Code.

## Platform compatibility
- Windows
- macOS
- Linux

## Requisites
- Visual Studio Code
- Node.js
- C# compiler
- NPM xml2object (`npm install --save-dev xml2object`)

## Generation process
The code is auto-generated from the FHIR DSTU-2 schema file (`fhir-single.xsd`) by the script `generate.js`

After that, the generated file (`fhir-single.cs`) is compiled using `dotnet`