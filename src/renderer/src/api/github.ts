import { get, post } from './client'

export interface GitHubUser {
  signedIn: boolean
  login?: string
  name?: string
}

/** GitHub account sign-in so pushes/pulls to github.com don't need a pasted PAT each time. */
export const githubApi = {
  login: (token: string) => post<GitHubUser>('/github/login', { token }),
  user: () => get<GitHubUser>('/github/user'),
  logout: () => post<GitHubUser>('/github/logout')
}
