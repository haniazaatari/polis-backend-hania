import React from "react";

const UncertaintyAnalysis = ({ uncertaintyData }) => {
  if (!uncertaintyData) return null;

  return (
    <article className="w-full max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Areas of Uncertainty</h1>

      {uncertaintyData.sections.map((section) => (
        <div key={section.id} className="mb-6">
          <h2 className="text-xl font-semibold mb-3">{section.title}</h2>

          {section.sentences.map((sentence, idx) => (
            <p key={idx} className="mb-4">
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
