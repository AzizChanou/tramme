export const REPO_NAME = 'kyogreultima/tramme';
export const REPO = `https://github.com/${REPO_NAME}`;
/** a file or folder of the repository, on its main branch */
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;
