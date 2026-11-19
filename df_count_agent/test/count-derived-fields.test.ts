import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { countFlowchartXml, countXmlFiles } from "../bot/lib/count-derived-fields.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/xml");

test("counts derived fields on each process box and skips output fields", () => {
  const xml = `<?xml version="1.0"?>
    <Flowchart name="Flowchart1">
      <Process name="Select1" type="Select">
        <DerivedFields>
          <DerivedField name="Utilization" persistent="true">
            <Expression><![CDATA[(Balance / CreditLimit) * 100]]></Expression>
          </DerivedField>
          <Field name="IncomeCopy"><Expression>Income * 1.0</Expression></Field>
        </DerivedFields>
        <OutputFields><Field name="CustomerID"/></OutputFields>
      </Process>
      <Process name="Snapshot1" type="Snapshot">
        <DerivedField name="MailBand" expression="Utilization / 10"/>
      </Process>
    </Flowchart>`;
  const result = countFlowchartXml(xml);
  assert.equal(result.flowchartName, "Flowchart1");
  assert.deepEqual(
    result.boxes.map((box) => [box.processName, box.processType, box.derivedFieldCount]),
    [
      ["Select1", "Select", 2],
      ["Snapshot1", "Snapshot", 1],
    ],
  );
  assert.equal(result.boxes[0]?.fields[0]?.persistent, true);
  assert.equal(result.boxes[0]?.fields[1]?.name, "IncomeCopy");
  assert.equal(result.boxes[1]?.fields[0]?.persistent, false);
  assert.equal(result.totalDerivedFields, 3);
  assert.deepEqual(result.notes, []);
});

test("reads namespaced process boxes and keeps an empty box at zero", () => {
  const xml = `<?xml version="1.0"?>
    <ns:Flowchart xmlns:ns="urn:unica" name="Winback">
      <ns:ProcessBox name="Extract1" type="Extract">
        <ns:PersistentDerivedField name="Recency" expression="DaysSince(LastPurchase)"/>
      </ns:ProcessBox>
      <ns:Process name="MailList1" type="MailList"/>
    </ns:Flowchart>`;
  const result = countFlowchartXml(xml);
  assert.deepEqual(
    result.boxes.map((box) => [box.processName, box.derivedFieldCount, box.fields[0]?.persistent ?? false]),
    [
      ["Extract1", 1, true],
      ["MailList1", 0, false],
    ],
  );
});

test("reports the tags it saw when the report has no derived fields", () => {
  const result = countFlowchartXml("<Catalog><Table name=\"Customer\"/></Catalog>");
  assert.equal(result.totalDerivedFields, 0);
  assert.deepEqual(result.observedTags, ["catalog", "table"]);
  assert.equal(result.notes.length > 0, true);
});

test("counts every sample report in the fixture directory", async () => {
  const result = await countXmlFiles(fixtures);
  assert.equal(result.files.length, 2);
  const spring = result.files.find((file) => file.fileName.startsWith("SpringSale"));
  const winback = result.files.find((file) => file.fileName.startsWith("Winback"));
  assert.equal(spring?.totalDerivedFields, 3);
  assert.equal(winback?.boxes.find((box) => box.processName === "Extract1")?.derivedFieldCount, 1);
  assert.equal(winback?.boxes.find((box) => box.processName === "MailList1")?.derivedFieldCount, 0);
});
