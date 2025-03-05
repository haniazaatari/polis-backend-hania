import React from "react";
import getNarrativeJSON from "../../util/getNarrativeJSON";

const Narrative = ({ sectionData, model }) => {
  if (!sectionData) return null;

  if (sectionData.errors) return (
    <p>Not enough data has been provided for analysis, please check back later</p>
  )


    const respData = getNarrativeJSON(sectionData, sectionData?.model);

  return (
    <article style={{ maxWidth: "600px" }}>
      {respData?.paragraphs?.map((section) => (
        <div key={section.id}>
          <h5>{section.title}</h5>

          {section.sentences.map((sentence, idx) => (
            <p key={JSON.stringify(sentence)}>
              {sentence.clauses.map((clause, cIdx) => (
                <span key={clause.text}>
                  {clause.text}
                  {clause.citations.map((citation, citIdx) => (
                    <sup key={JSON.stringify(citation)}>
                      {typeof citation === 'object' ?  Object.entries(citation)[1] : citation}
                      {citIdx < clause.citations.length - 1 ? ", " : ""}
                    </sup>
                  ))}
                  {cIdx < sentence.clauses.length - 1 ? " " : ""}
                </span>
              ))}
            </p>
          ))}
        </div>
      ))}
    </article>
  );
};

export default Narrative;
