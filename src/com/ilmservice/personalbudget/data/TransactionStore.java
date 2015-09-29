package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.context.RequestScoped;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.google.protobuf.ByteString;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.repository.IDbScope;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;
import com.ilmservice.repository.TransactionPerRequest;

@Default
@Singleton
public class TransactionStore implements ITransactionStore {
	
	@Inject 
	@TransactionPerRequest
	private IDbScope scope;
	
	@Inject 
	private IRepository<Transaction> transactions;
	
	private IRepositoryIndex<ByteString, Transaction> transactionsById;
	private MessageDigest sha;
	
	TransactionStore() throws NoSuchAlgorithmException {
		sha = MessageDigest.getInstance("SHA");
	}
	
	@PostConstruct
	public void configure() {
		System.out.println("TransactionStore configuring");
		transactions.configure( 
			scope,
			(bytes) -> Transaction.parseFrom(bytes),
			(transaction) -> transaction.toByteArray(),
			() -> {
				try {
					System.out.println("TransactionStore indexes ");
					transactionsById = transactions.configureIndex(
						Indexes.TransactionsById.getValue(),
						(k) -> Transaction.newBuilder().setId(k).build(),
						(v) -> v.getId(),
						(k) -> {
							byte[] result = new byte[k.size()];
							k.copyTo(result,0);
							return result;
						}
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
					
	}
	
	@Override
	public void put(Transaction.Builder builder) {
		byte[] idBytes = sha.digest(builder.build().toByteArray());
		builder.setId(ByteString.copyFrom(idBytes));
		transactions.put(builder.build());
	}
	
//	public Transaction test(int id) {
//		Transaction modified = null;
//		try {
//			System.out.println("TransactionStore testing  ");
//			Transaction result = transactionsById.query().atKey(id).firstOrDefault();
//			System.out.println(result.toString());
//			modified = Transaction.newBuilder(result)
//									.setDescription(result.getDescription() + " :)  ").build();
//			
//			System.out.println(modified.toString());
//			transactions.put(modified);
//			
//		} catch (IOException e) {
//			System.out.println("TransactionStore testing failed ");
//			// TODO Auto-generated catch block
//			e.printStackTrace();
//		}
//		return modified;
//	}
}
