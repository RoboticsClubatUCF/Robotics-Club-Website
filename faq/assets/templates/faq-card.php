<?php
  // This class can generate a collapsible card with a question and answer
  // Created Nov 4 by Alexandra French
  // Last updated Nov 4 by Alexandra French

  class FaqCard {
    private $number;

    // Uses a counter to keep track of each announcement for color swapping
    public function __construct() {
      $this->number = 1;
    }
    
    // sets the counter to the new value
    public function setCounter($value){
      $this->number = $value;
    }
    
    // generates a card and an answer to the card. For use within an accordian.
    public function generate($section, $question, $answer, $isFirst) {
      echo "<!-- q" . $this->number . " -->\n          ";
      echo "<div class=\"";
      if ($this->number%2 == 1) {
        echo "card-blk-gray";
      } else {
        echo "card-wht-gray";
      }
      echo "\">\n            ";
      echo "<div class=\"card-header\" id=\"" .  "heading" . $section . $this->number . "\">\n              ";
      echo "<div class=\"mb-0\">\n                ";
      echo "<button class=\"btn btn-link";
      if (!$isFirst) {
        echo " collapsed";
      }      
      echo "\" data-toggle=\"collapse\" data-target=\"#collapse" . $section . $this->number . "\" aria-expanded=\"";
      if ($isFirst) {
        echo "true";
      } else {
        echo "false";
      }
      echo "\" aria-controls=\"collapse" . $section . $this->number . "\">";
      echo "\n                  <div class=\"faq-text\"><h3>" . $question . "</h3></div>";
      echo "\n                </button>
              </div>
            </div>";
      echo "\n            <div id=\"collapse" . $section . $this->number . "\" class=\"collapse";
      if ($isFirst) {
        echo " show";
      }
      echo "\" aria-labelledby=\"" . "heading" . $section . $this->number . "\" data-parent=\"#faq-accordion" . $section . "\">";
      echo "\n              <div class=\"card-body\">";
      echo "\n                <p>" . $answer . "</p>";
      echo "\n              </div>
            </div>
          </div>";
      echo "\n          <!-- /.q" . $this->number . " -->\n          ";
      
      $this->number += 1;
    }
  }

?>
