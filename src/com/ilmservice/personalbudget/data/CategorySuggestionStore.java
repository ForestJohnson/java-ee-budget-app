package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.context.RequestScoped;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.google.protobuf.ByteString;
import com.ilmservice.personalbudget.protobufs.Data.CategoryKeyword;
import com.ilmservice.personalbudget.protobufs.Data.CategorySuggestion;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Data.TransactionCategory;
import com.ilmservice.personalbudget.protobufs.Views.DateRangeFilter;
import com.ilmservice.personalbudget.protobufs.Views.Filter;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;
import com.ilmservice.personalbudget.protobufs.Views.UnsortedTransaction;
import com.ilmservice.repository.IDbScope;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;
import com.ilmservice.repository.IRepository.IRepositoryQuery;
import com.ilmservice.repository.TransactionPerRequest;

@Default
@Singleton
public class CategorySuggestionStore implements ICategorySuggestionStore {
	
	@Inject 
	@TransactionPerRequest
	private IDbScope scope;
	
	@Inject 
	private IRepository<CategoryKeyword> suggestions;
	
	private IRepositoryIndex<String, CategoryKeyword> suggestionsByKeyword;
	
	@PostConstruct
	public void configure() {
		System.out.println("CategorySuggestionStore configuring           ");
		suggestions.configure( 
			scope,
			(bytes) -> CategoryKeyword.parseFrom(bytes),
			(transaction) -> transaction.toByteArray(),
			() -> {
				try {
					System.out.println("CategorySuggestionStore indexes ");

					suggestionsByKeyword = suggestions.configureIndex(
						Indexes.TransactionCategoriesByKeyword.getValue(),
						(k) -> CategoryKeyword.newBuilder().setKeyword(k).build(),
						(v) -> v.getKeyword(),
						(k) -> k.getBytes()
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
					
	}
	
	@Override
	public void put(Transaction transaction) throws IOException {
		String[] terms = getTerms(transaction);
		for (int i = 0; i < terms.length; i++) {
			CategoryKeyword.Builder builder = CategoryKeyword.newBuilder(
					suggestionsByKeyword.query().atKey(terms[i]).firstOrDefault()
				);
			
			builder.setKeyword(terms[i]);
			
			Optional<CategorySuggestion.Builder> maybeSuggestionBuilder = 
				builder.getSuggestionsBuilderList().stream()
				.filter((suggestion) -> suggestion.getCategoryId() == transaction.getCategoryId())
				.findFirst();
			CategorySuggestion.Builder suggestionBuilder = null;
			if(!maybeSuggestionBuilder.isPresent()) {
				suggestionBuilder = CategorySuggestion.newBuilder()
						.setCategoryId(transaction.getCategoryId());
				builder.addSuggestions(suggestionBuilder);
			} else {
				suggestionBuilder = maybeSuggestionBuilder.get();
			}
			
			suggestionBuilder.setPopularity(suggestionBuilder.getPopularity()+1);
			
			suggestions.put(builder.build());
		}
	}
	
	@Override
	public Map<Integer, Float> suggest (Transaction transaction) throws IOException {
		String[] terms = getTerms(transaction);
		Map<Integer, Float> aggregator = new HashMap<Integer, Float>();
		
		for (int i = 0; i < terms.length; i++) {
			CategoryKeyword keyword = suggestionsByKeyword.query().atKey(terms[i]).firstOrDefault();
			int total = keyword.getSuggestionsList().stream()
					.mapToInt((suggestion) -> suggestion.getPopularity())
					.sum();
			
			keyword.getSuggestionsList().stream().forEach((suggestion) -> {
				aggregator.compute(suggestion.getCategoryId(), (k, v) -> {
					float toAdd = (float)suggestion.getPopularity() / total;
					return v == null ? toAdd : v + toAdd;
				});
			});
		}
		
		return aggregator;
	}
	
	private String[] getTerms (Transaction transaction) {
		 return transaction.getDescription().split(" +");
	}

}
