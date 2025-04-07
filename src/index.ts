"use strict";

// Define interfaces for our data types
interface SearchCriteria {
  title: string;
  description: string;
  creator: string;
  related: string;
  organisation: string;
}

interface NameIdentifier {
  nameIdentifier: string;
  nameIdentifierScheme?: string;
}

interface Creator {
  name: string;
  nameType?: string;
  givenName?: string;
  familyName?: string;
  nameIdentifiers?: NameIdentifier[];
}

interface RelatedIdentifier {
  relatedIdentifier: string;
  relatedIdentifierType?: string;
  relationType?: string;
}

interface Contributor {
  name: string;
  nameType?: string;
  givenName?: string;
  familyName?: string;
  nameIdentifiers?: NameIdentifier[];
  contributorType?: string;
}

interface Description {
  description: string;
  descriptionType?: string;
  lang?: string;
}

interface Title {
  title: string;
  titleType?: string;
  lang?: string;
}

interface Attributes {
  doi: string;
  titles?: Title[];
  creators?: Creator[];
  relatedIdentifiers?: RelatedIdentifier[];
  contributors?: Contributor[];
  descriptions?: Description[];
  [key: string]: any; // For other potential attributes
}

interface Item {
  id?: string;
  type?: string;
  attributes: Attributes;
  relationships?: any;
}

interface ApiResponse {
  data: Item[];
  meta?: any;
  links?: any;
}

// Set to store files for downloading
const filesToDownload = new Set<string>();

/**
 * Downloads files from an array of URLs
 * @param urls Array of URLs to download from
 */
async function downloadFiles(urls: string[]): Promise<void> {
  for (let i = 0; i < urls.length; i++) {
    try {
      const url = urls[i];
      if (!url) continue;

      const urlParts = url.split("/");
      const lastThreeParts = urlParts.slice(-3);
      const [prefix, suffixWithDot] = lastThreeParts;
      const [suffix] = suffixWithDot.split(".");

      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = url.split("/").pop() || `raid-${prefix}-${suffix}.json`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(objectUrl);
      }, 100);

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error downloading file ${urls[i]}:`, error);
    }
  }
}

/**
 * Highlights search text in a string
 * @param text The text to search within
 * @param query The search query to highlight
 * @returns Text with search query highlighted
 */
const highlightText = (text: string, query: string): string => {
  if (!query) return text;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  return text.replace(regex, "<mark>$1</mark>");
};

/**
 * Searches a single API with the given criteria
 * @param apiUrl API URL to search
 * @param searchCriteria Search criteria object
 * @param operator Logical operator (AND/OR) for combining search terms
 * @returns Promise resolving to API response
 */
const searchSingleApi = async (
  apiUrl: string,
  searchCriteria: SearchCriteria,
  operator: string
): Promise<ApiResponse> => {
  const queryParts: string[] = [];

  if (searchCriteria.title) {
    queryParts.push(
      `titles.title:*${encodeURIComponent(searchCriteria.title)}*`
    );
  }

  if (searchCriteria.description) {
    queryParts.push(
      `descriptions.description:*${encodeURIComponent(
        searchCriteria.description
      )}*`
    );
  }

  if (searchCriteria.creator) {
    queryParts.push(
      `creators.name:"${encodeURIComponent(searchCriteria.creator)}"`
    );
  }

  if (searchCriteria.related) {
    queryParts.push(
      `relatedIdentifiers.relatedIdentifier:"${encodeURIComponent(
        searchCriteria.related
      )}"`
    );
  }

  if (searchCriteria.organisation) {
    queryParts.push(
      `contributors.nameIdentifiers.nameIdentifier:"${encodeURIComponent(
        searchCriteria.organisation
      )}"`
    );
  }

  if (queryParts.length === 0) {
    return { data: [] };
  }

  const queryString = `(identifiers.identifier:*raid.org.au* AND (${queryParts.join(
    ` ${operator} `
  )}))`;
  const url = `${apiUrl}?query=${queryString}&page[size]=10000`;

  const response = await fetch(url);
  return response.json() as Promise<ApiResponse>;
};

/**
 * Searches DOIs across multiple APIs
 * @param searchCriteria Search criteria object
 * @param operator Logical operator for combining search terms
 * @returns Promise resolving to combined API response
 */
const searchDois = async (
  searchCriteria: SearchCriteria,
  operator: string
): Promise<ApiResponse> => {
  const hasAtLeastOneQuery = Object.values(searchCriteria).some(
    (value) => value.trim() !== ""
  );

  if (!hasAtLeastOneQuery) {
    throw new Error("At least one search criterion is required");
  }

  const apis: string[] = ["https://api.datacite.org/dois"];

  const results = await Promise.allSettled(
    apis.map((api) => searchSingleApi(api, searchCriteria, operator))
  );

  const combinedData = results.reduce<Item[]>((acc, result) => {
    if (result.status === "fulfilled") {
      return [...acc, ...result.value.data];
    }
    return acc;
  }, []);

  return { data: combinedData };
};

/**
 * Creates an HTML element for a search result
 * @param item Result item data
 * @param searchCriteria Original search criteria
 * @returns HTML div element with the result
 */
const createResultElement = (
  item: Item,
  searchCriteria: SearchCriteria
): HTMLElement => {
  const { attributes } = item;
  const resultDiv = document.createElement("div");
  resultDiv.className = "search-result";

  const titles =
    attributes?.titles
      ?.map((t) =>
        searchCriteria.title
          ? highlightText(t.title, searchCriteria.title)
          : t.title
      )
      .filter(Boolean)
      .join(" | ") || "No Title";

  const doi = attributes?.doi;
  const doiLink = doi
    ? `<a href="https://raid.org/${doi}" target="_blank">${
        searchCriteria.related
          ? highlightText(doi, searchCriteria.related)
          : doi
      }</a>`
    : "No DOI";

  let creatorsLinks = "";
  if (attributes?.creators && attributes?.creators.length > 0) {
    for (const creator of attributes?.creators) {
      const highlightedName = searchCriteria.creator
        ? highlightText(creator.name, searchCriteria.creator)
        : creator.name;
      creatorsLinks += `<a href="${creator.name}" target="_blank">${highlightedName}</a> & `;
    }
    creatorsLinks = creatorsLinks.slice(0, -3);
  }

  let relatedIdentifiersLinks = "";
  if (
    attributes?.relatedIdentifiers &&
    attributes.relatedIdentifiers.length > 0
  ) {
    for (const relatedId of attributes.relatedIdentifiers) {
      const highlightedId = searchCriteria.related
        ? highlightText(relatedId.relatedIdentifier, searchCriteria.related)
        : relatedId.relatedIdentifier;
      relatedIdentifiersLinks += `<a href="${relatedId.relatedIdentifier}" target="_blank">${highlightedId}</a> & `;
    }
    relatedIdentifiersLinks = relatedIdentifiersLinks.slice(0, -3);
  }

  let organisationsLinks = "";
  if (attributes?.contributors && attributes.contributors.length > 0) {
    for (const contributor of attributes.contributors) {
      if (
        contributor.nameIdentifiers &&
        contributor.nameIdentifiers.length > 0
      ) {
        for (const nameId of contributor.nameIdentifiers) {
          if (
            nameId.nameIdentifier &&
            nameId.nameIdentifier.includes("ror.org")
          ) {
            const rorId = nameId.nameIdentifier.split("/").pop() || "";
            const highlightedName = searchCriteria.organisation
              ? highlightText(
                  nameId.nameIdentifier,
                  searchCriteria.organisation
                )
              : nameId.nameIdentifier;
            organisationsLinks += `<a href="https://ror.org/${rorId}" target="_blank">${highlightedName}</a> & `;
          }
        }
      }
    }
    organisationsLinks = organisationsLinks
      ? organisationsLinks.slice(0, -3)
      : "";
  }

  const description = searchCriteria.description
    ? highlightText(
        attributes?.descriptions?.[0]?.description || "No Description",
        searchCriteria.description
      )
    : attributes?.descriptions?.[0]?.description || "No Description";

  resultDiv.innerHTML = `
      <h3>${titles}</h3>
      <p>RAiD: ${doiLink}</p>
      <p>Creators: ${creatorsLinks || "No creators"}</p>
      <p>Related Identifiers: ${
        relatedIdentifiersLinks || "No related identifiers"
      }</p>
      <p>Organisations: ${organisationsLinks || "No organisations"}</p>
      <p>Description: ${description}</p>
  `;

  return resultDiv;
};

/**
 * Renders search results to a container
 * @param container HTML element to render results into
 * @param data API response data
 * @param searchCriteria Original search criteria
 */
const renderResults = (
  container: HTMLElement,
  data: ApiResponse,
  searchCriteria: SearchCriteria
): void => {
  if (!data?.data?.length) {
    container.innerHTML = "<p>No results found</p>";
    return;
  }

  const downloadButton = document.createElement("button");
  container.innerHTML = "";
  downloadButton.innerText = "Download Results";
  downloadButton.id = "download-results";
  downloadButton.style.backgroundColor = "#008ccf";
  container.appendChild(downloadButton);

  data.data.forEach((item) => {
    container.appendChild(createResultElement(item, searchCriteria));
    filesToDownload.add(
      `https://static.prod.raid.org.au/raids/${item.attributes.doi}.download/`
    );
  });

  downloadButton.addEventListener("click", () => {
    downloadFiles(Array.from(filesToDownload));
  });
};

/**
 * Performs search based on form input values
 * @param event Optional form submission event
 */
async function performSearch(event?: Event): Promise<void> {
  // If event exists (form submission), prevent default
  if (event) {
    event.preventDefault();
  }

  const container = document.getElementById("results-container");
  if (!container) {
    console.error("Results container not found");
    return;
  }

  try {
    const searchCriteria: SearchCriteria = {
      title:
        (document.getElementById("title-search") as HTMLInputElement)?.value ||
        "",
      description:
        (document.getElementById("description-search") as HTMLInputElement)
          ?.value || "",
      creator:
        (document.getElementById("creator-search") as HTMLInputElement)
          ?.value || "",
      related:
        (document.getElementById("related-search") as HTMLInputElement)
          ?.value || "",
      organisation:
        (document.getElementById("organisation-search") as HTMLInputElement)
          ?.value || "",
    };

    const operatorElement = document.querySelector(
      'input[name="operator"]:checked'
    ) as HTMLInputElement;
    const operator = operatorElement?.value || "AND";

    const hasAtLeastOneCriterion = Object.values(searchCriteria).some(
      (value) => value.trim() !== ""
    );
    if (!hasAtLeastOneCriterion) {
      alert("Please enter at least one search term");
      return;
    }

    container.innerHTML = "Loading...";
    const data = await searchDois(searchCriteria, operator);
    renderResults(container, data, searchCriteria);
  } catch (error) {
    console.error("Error:", error);
    container.innerHTML = "<p>Error fetching results. Please try again.</p>";
  }
}

// Add event listeners when the DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  // Get a reference to the search form
  const searchForm = document.getElementById("search-form");

  // Add submit event listener to the form
  if (searchForm) {
    searchForm.addEventListener("submit", performSearch);
  } else {
    console.error("Search form not found");

    // Fallback to button click if form not found
    const searchButton = document.getElementById("search-button");
    if (searchButton) {
      searchButton.addEventListener("click", performSearch);
    } else {
      console.error("Search button not found");
    }
  }

  // Add event listeners for example buttons
  const exampleButtons = document.querySelectorAll(".example-button");
  exampleButtons.forEach((button) => {
    button.addEventListener("click", function (this: HTMLElement) {
      const fieldId = this.getAttribute("data-field");
      if (fieldId) {
        const field = document.getElementById(fieldId) as HTMLInputElement;
        if (field) {
          field.value = this.textContent?.trim() || "";
        }
      }
    });
  });
});
