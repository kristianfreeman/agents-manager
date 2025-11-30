import { useState, useEffect, useRef } from "react";
import {
  GithubLogo,
  MagnifyingGlass,
  X,
  GitBranch
} from "@phosphor-icons/react";
import { Card } from "@/components/card/Card";

interface Repository {
  id: string;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  description?: string;
  private: boolean;
}

interface RepositorySelectorProps {
  onRepositorySelect: (repo: Repository | null) => void;
  selectedRepository: Repository | null;
}

export function RepositorySelector({
  onRepositorySelect,
  selectedRepository
}: RepositorySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && repos.length === 0) {
      fetchRepositories();
    }
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const fetchRepositories = async () => {
    setLoading(true);
    console.log(
      "[RepositorySelector] Fetching repositories from /agents/chat/default/repositories"
    );
    try {
      const response = await fetch("/agents/chat/default/repositories");
      console.log("[RepositorySelector] Response status:", response.status);
      if (response.ok) {
        const data = (await response.json()) as Repository[];
        console.log(
          "[RepositorySelector] Fetched repositories:",
          data.length,
          data
        );
        setRepos(data);
      } else {
        const errorText = await response.text();
        console.error(
          "[RepositorySelector] Failed to fetch repositories:",
          response.status,
          errorText
        );
      }
    } catch (error) {
      console.error(
        "[RepositorySelector] Failed to fetch repositories:",
        error
      );
    } finally {
      setLoading(false);
    }
  };

  const filteredRepos = repos.filter(
    (repo) =>
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectRepo = (repo: Repository) => {
    onRepositorySelect(repo);
    setIsOpen(false);
    setSearchQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Unified Button with Icon + Text */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 rounded-md text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
      >
        <GithubLogo
          size={18}
          weight={selectedRepository ? "fill" : "regular"}
        />
        <span className="text-xs">
          {selectedRepository ? selectedRepository.name : "Select a repo"}
        </span>
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <Card className="absolute bottom-full mb-2 left-0 w-96 max-h-[500px] flex flex-col bg-white dark:bg-neutral-900 shadow-xl border border-neutral-200 dark:border-neutral-800 z-50">
          {/* Search */}
          <div className="p-3 border-b border-neutral-200 dark:border-neutral-800">
            <div className="relative">
              <MagnifyingGlass
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
              />
              <input
                type="text"
                placeholder="Search repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-600"
              />
            </div>
          </div>

          {/* Repository List */}
          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="text-center py-8 text-neutral-600 dark:text-neutral-400 text-sm">
                Loading repositories...
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="text-center py-8 text-neutral-600 dark:text-neutral-400 text-sm">
                {searchQuery
                  ? `No repositories found matching "${searchQuery}"`
                  : "No repositories available"}
              </div>
            ) : (
              <div className="space-y-1.5">
                {/* Clear Selection Option */}
                {selectedRepository && (
                  <button
                    onClick={() => handleSelectRepo(null as any)}
                    className="w-full text-left p-2 rounded-md border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-850 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <X size={14} className="text-neutral-500" />
                      <span className="text-xs text-neutral-600 dark:text-neutral-400">
                        Clear selection
                      </span>
                    </div>
                  </button>
                )}

                {filteredRepos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => handleSelectRepo(repo)}
                    className={`w-full text-left p-2 rounded-md border transition-colors ${
                      selectedRepository?.id === repo.id
                        ? "border-[#F48120] bg-[#F48120]/5"
                        : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-850"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <GitBranch
                            size={14}
                            weight="fill"
                            className={
                              selectedRepository?.id === repo.id
                                ? "text-[#F48120]"
                                : "text-neutral-600 dark:text-neutral-400"
                            }
                          />
                          <span className="font-medium text-xs truncate">
                            {repo.full_name}
                          </span>
                          {repo.private && (
                            <span className="text-[10px] px-1 py-0.5 bg-neutral-200 dark:bg-neutral-700 rounded">
                              Private
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-[11px] text-neutral-600 dark:text-neutral-400 mt-0.5 line-clamp-1 ml-5">
                            {repo.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
