import React from "react";

const UncertaintyAnalysis = ({ narrativeData }) => {
  if (!narrativeData) return null;

  console.log("narrativeData", narrativeData);

  const uncertaintyData = narrativeData.uncertainty;

  return (
    <article style={{ maxWidth: "600px", fontFamily: "Georgia, serif" }}>
      <h1>Areas of Uncertainty</h1>

      {uncertaintyData.sections.map((section) => (
        <div key={section.id}>
          <h4>{section.title}</h4>

          {section.sentences.map((sentence, idx) => (
            <p key={idx}>
              {sentence.clauses.map((clause, cIdx) => (
                <span key={cIdx}>
                  {clause.text}
                  {clause.citations.map((citation, citIdx) => (
                    <sup key={citIdx}>
                      {citation}
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

export default UncertaintyAnalysis;
