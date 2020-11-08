<?php

  class Pagination {
    private $current;
    private $previous;
    private $next;

    public function __construct($current, $previous, $next) {
      $this->current = $current;
      $this->previous = $previous;
      $this->next = $next;
    }

    public function generate($pages, $years) {
      echo "<!-- pagination -->\n";
      echo "  <ul class=\"pagination justify-content-center\">\n";

      // set previous arrow
      if (isset($this->previous)) {
        $this->generateArrows("Previous", $pages);
      }

      // set all the inner pages
      $counter = 0;
      while ($counter < count($pages)) {
        $this->generatePage($pages, $pages[$counter], $years);
        $counter += 1;
      }

      // set next arrow
      if (isset($this->next)) {
        $this->generateArrows("Next", $pages);
      }

      echo "  </ul>\n";
      echo "  <!-- pagination -->\n";
    }

    private function generateArrows($direction, $pages) {
      echo "    <li class=\"page-item\">\n";
      echo "      <a class=\"page-link\" href=\"";
      if ($direction == "Previous") {
        if ($this->current == $pages[1]) {
          echo "index";
        } else {
          echo $this->previous;
        }
      } else {
          if ($this->current == "index") {
            echo $pages[1];
          } else {
            echo $this->next;
          }
      }
      echo "\" aria-label=\"" . $direction . "\">\n";
      echo "        <span aria-hidden=\"true\">\n";
      if ($direction == "Previous") {
        echo "&laquo";
      } else {
        echo "&raquo";
      }
      echo "</span>";
      echo "        <span class=\"sr-only\">" . $direction . "</span>\n";
      echo "      </a>\n    </li>";
    }

    private function generatePage($pages, $page, $years) {
      echo "    <li class=\"page-item";
      if ($this->current == $page) {
        echo " active ";
      }
      echo "\">\n";
      echo "      <a class=\"page-link\" href=\"" . $page . "\">";
      if (!$years && $page == "index") {
        echo "Current";
      } elseif (!$years) {
        echo $page;
      } elseif ($page == "index") {
        echo $pages[1] . "-" . ($pages[1]+1);
      } elseif($page != "index") {
        echo ($page-1) . "-" . $page;
      }
      echo "</a>\n";
      echo "    </li>\n";
    }
  }

?>
